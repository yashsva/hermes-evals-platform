import { ConfigSpec, TaskSpec } from '@evals/shared';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { HermesCliAdapter } from './hermes-cli.adapter';
import { isProviderError, parseStreamJson } from './stream-json';
import { prepareTrialDirs, trialDirs } from './trial-dirs';

// Captured from `hermes chat -q … --format stream-json` (Hermes v0.22.7), trimmed.
const RECORDED = [
  '{"type": "system", "subtype": "init", "model": "openai/gpt-4o-mini", "session_id": "s1", "timestamp": 1}',
  '{"type": "tool_use", "name": "read_file", "input": {"path": "sales.csv"}}',
  '{"type": "tool_result", "name": "read_file", "output": "region,amount\\nnorth,10", "duration_ms": 4, "is_error": false}',
  '{"type": "text", "text": "The north "}',
  '{"type": "text", "text": "total is 10."}',
  '{"type": "result", "session_id": "s1", "exit_code": 0, "text": "The north total is 10.", "tokens": {"input": 5120, "output": 48, "total": 5168, "cache_read": 0, "cache_write": 0}, "duration_ms": 2300}',
].join('\n');

describe('parseStreamJson', () => {
  it('parses events, merges text deltas and reads the result', () => {
    const parsed = parseStreamJson(RECORDED);
    expect(parsed.events.map((e) => e.type)).toEqual(['system', 'tool_use', 'tool_result', 'text', 'result']);
    expect(parsed.events[3].payload.text).toBe('The north total is 10.');
    expect(parsed.result).toEqual({
      text: 'The north total is 10.',
      exitCode: 0,
      tokens: { input: 5120, output: 48, cacheRead: 0 },
      durationMs: 2300,
      error: null,
    });
  });

  it('keeps malformed lines as unparsed events and reports a missing result', () => {
    const parsed = parseStreamJson('{"type":"system"}\nTraceback (most recent call last):\n');
    expect(parsed.result).toBeNull();
    expect(parsed.events[1]).toEqual({ type: 'unparsed', payload: { line: 'Traceback (most recent call last):' } });
  });

  it('captures the error of a failed run (recorded: missing credentials)', () => {
    const parsed = parseStreamJson(
      '{"type": "result", "session_id": "", "exit_code": 1, "text": "", "tokens": {"input": 0, "output": 0, "total": 0, "cache_read": 0, "cache_write": 0}, "duration_ms": 1200, "error": "credentials or agent init failed"}',
    );
    expect(parsed.result?.exitCode).toBe(1);
    expect(parsed.result?.error).toBe('credentials or agent init failed');
  });

  it('records the real no-credentials failure (Hermes v0.22.7) with zero tokens', () => {
    // Exact stdout from running the pinned image in a trial home with no API key configured.
    const parsed = parseStreamJson(
      '{"type": "system", "subtype": "init", "model": "openai/gpt-4.1-nano", "session_id": "", "timestamp": 1}\n' +
        '{"type": "result", "session_id": "", "exit_code": 1, "text": "", "tokens": {"input": 0, "output": 0, "total": 0, "cache_read": 0, "cache_write": 0}, "duration_ms": 19000, "error": "ProviderNotConfiguredError: No LLM provider configured."}',
    );
    expect(parsed.result?.tokens).toEqual({ input: 0, output: 0, cacheRead: 0 });
    expect(isProviderError(parsed.result!.error!)).toBe(false);
  });

  it('classifies provider-side failures for retry', () => {
    expect(isProviderError('HTTP 429 Too Many Requests')).toBe(true);
    expect(isProviderError('upstream returned 503')).toBe(true);
    expect(isProviderError('Gateway disconnected; turn outcome is unknown.')).toBe(true);
    expect(isProviderError('credentials or agent init failed')).toBe(false);
  });
});

const config: ConfigSpec = {
  provider: 'openrouter',
  model: 'some/model',
  toolsets: ['file', 'terminal'],
  skills: ['acme-format'],
  memory: { enabled: true, entries: ['Project codename is HELIOS', 'Reports go to finance'] },
  maxTurns: 6,
};
const task: TaskSpec = {
  prompt: 'Summarise data/sales.csv',
  tags: [],
  files: [{ path: 'data/sales.csv', content: 'region,amount\nnorth,10\n' }],
  checks: [{ name: 'c', type: 'contains', target: { kind: 'answer' }, value: '10', caseSensitive: false, weight: 1, required: false }],
  passThreshold: 1,
  timeoutSec: 60,
};

describe('trial directories', () => {
  let root: string;
  beforeAll(async () => (root = await mkdtemp(join(tmpdir(), 'trial-dirs-test-'))));
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('writes config, skills, memory and fixtures into a fresh home and workspace', async () => {
    const dirs = trialDirs(root, 1);
    await prepareTrialDirs(dirs, task, config, [{ key: 'acme-format', spec: { description: 'ACME format', body: '# Rules' } }]);

    const yaml = parse(await readFile(join(dirs.home, 'config.yaml'), 'utf8'));
    expect(yaml.model).toEqual({ default: 'some/model', provider: 'openrouter' });
    expect(yaml.memory.memory_enabled).toBe(true);
    expect(yaml.auxiliary.background_review.enabled).toBe(false);
    expect(await readFile(join(dirs.home, 'skills/acme-format/SKILL.md'), 'utf8')).toMatch(/^---\nname: acme-format\n/);
    expect(await readFile(join(dirs.home, 'memories/MEMORY.md'), 'utf8')).toBe('Project codename is HELIOS\n§\nReports go to finance');
    expect(await readFile(join(dirs.workspace, 'data/sales.csv'), 'utf8')).toContain('north,10');
  });

  it('isolates trials: memory written during one trial never reaches the next', async () => {
    const first = trialDirs(root, 2);
    await prepareTrialDirs(first, task, { ...config, memory: { enabled: true, entries: [] } }, []);
    // Simulate the agent saving a memory and leaving a file behind during trial 2.
    await writeFile(join(first.home, 'memories/MEMORY.md'), 'secret learned in trial 2');
    await writeFile(join(first.workspace, 'leftover.txt'), 'x');

    const second = trialDirs(root, 3);
    await prepareTrialDirs(second, task, { ...config, memory: { enabled: true, entries: [] } }, []);
    expect(existsSync(join(second.home, 'memories/MEMORY.md'))).toBe(false);
    expect(existsSync(join(second.workspace, 'leftover.txt'))).toBe(false);

    // Re-preparing the same trial id (a retry) also starts clean.
    await prepareTrialDirs(first, task, { ...config, memory: { enabled: false, entries: [] } }, []);
    expect(existsSync(join(first.home, 'memories/MEMORY.md'))).toBe(false);
  });
});

describe('HermesCliAdapter against stub binaries', () => {
  let dir: string;
  beforeAll(async () => (dir = await mkdtemp(join(tmpdir(), 'hermes-stub-'))));
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function stub(name: string, script: string): Promise<HermesCliAdapter> {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return new HermesCliAdapter(path);
  }
  const run = (adapter: HermesCliAdapter, timeoutMs = 10_000) =>
    adapter.run({ trialId: 1, task, config, skills: [], homeDir: dir, workspaceDir: dir, timeoutMs });

  it('parses a successful run and passes HERMES_HOME', async () => {
    const adapter = await stub('ok', `echo '{"type":"system","home":"'$HERMES_HOME'"}'\necho '${RECORDED.split('\n')[5]}'`);
    const result = await run(adapter);
    expect(result.error).toBeNull();
    expect(result.finalText).toBe('The north total is 10.');
    expect(result.events[0].payload.home).toBe(dir);
  });

  it('classifies a pre-model failure (no tokens) as setup', async () => {
    const adapter = await stub('nokey', `echo '{"type":"result","exit_code":1,"text":"","tokens":{"input":0,"output":0},"error":"ProviderNotConfiguredError: No LLM provider configured."}'\nexit 1`);
    const result = await run(adapter);
    expect(result.errorKind).toBe('setup');
  });

  it('classifies a failure after model calls (e.g. max turns) as agent', async () => {
    const adapter = await stub('maxturns', `echo '{"type":"result","exit_code":1,"text":"partial","tokens":{"input":900,"output":40},"error":"max turns reached"}'\nexit 1`);
    expect((await run(adapter)).errorKind).toBe('agent');
  });

  it('classifies rate limits as provider errors (retried)', async () => {
    const adapter = await stub('ratelimit', `echo '{"type":"result","exit_code":1,"text":"","tokens":{"input":0,"output":0},"error":"HTTP 429 Too Many Requests"}'\nexit 1`);
    expect((await run(adapter)).errorKind).toBe('provider');
  });

  it('reports a crash without a result event', async () => {
    const adapter = await stub('crash', `echo 'Traceback (most recent call last):' >&2\nexit 1`);
    const result = await run(adapter);
    expect(result.errorKind).toBe('no_result');
    expect(result.stderrTail).toContain('Traceback');
  });

  it('kills the process group on timeout', async () => {
    const adapter = await stub('hang', `sleep 30 &\nsleep 30`);
    const started = Date.now();
    const result = await run(adapter, 500);
    expect(result.errorKind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('reports a missing binary as a spawn error', async () => {
    const result = await run(new HermesCliAdapter(join(dir, 'does-not-exist')));
    expect(result.errorKind).toBe('spawn');
  });
});

describe('HermesCliAdapter.buildArgs', () => {
  it('maps a config onto hermes chat flags', () => {
    const args = new HermesCliAdapter().buildArgs({
      trialId: 1,
      task,
      config,
      skills: [{ key: 'acme-format', spec: { description: 'd', body: 'b' } }],
      homeDir: '/h',
      workspaceDir: '/w',
      timeoutMs: 1000,
    });
    expect(args).toEqual([
      'chat', '-q', 'Summarise data/sales.csv', '--format', 'stream-json', '-m', 'some/model', '--provider', 'openrouter',
      '-t', 'file,terminal', '--max-turns', '6', '--yolo', '-s', 'acme-format',
    ]);
  });
});
