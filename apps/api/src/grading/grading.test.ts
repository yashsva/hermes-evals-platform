import { TaskSpec } from '@evals/shared';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractJson, getPath, gradeTrial, runScriptCheck, scoreChecks } from './grading';

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'grading-test-'));
  await writeFile(join(workspace, 'NOTES.md'), 'ACME-REL v3\n- fix #42\n- add export\n');
});
afterAll(() => rm(workspace, { recursive: true, force: true }));

const task = (checks: TaskSpec['checks'], passThreshold = 1): TaskSpec => ({
  prompt: 'p',
  tags: [],
  files: [],
  checks,
  passThreshold,
  timeoutSec: 60,
});

const answer = { kind: 'answer' as const };

describe('gradeTrial', () => {
  it('passes contains/regex/json checks and explains each', async () => {
    const result = await gradeTrial(
      task([
        { name: 'mentions total', type: 'contains', target: answer, value: 'TOTAL', caseSensitive: false, weight: 1, required: false },
        { name: 'header', type: 'regex', target: { kind: 'file', path: 'NOTES.md' }, pattern: '^ACME-REL v\\d+', flags: 'm', weight: 1, required: false },
        { name: 'json total', type: 'json', target: answer, field: 'totals.north', equals: 42, weight: 2, required: false },
      ]),
      { finalText: 'Here you go, total:\n```json\n{"totals": {"north": "42"}}\n```', workspaceDir: workspace },
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.checks.map((c) => c.passed)).toEqual([true, true, true]);
    expect(result.checks[2].reason).toBe('totals.north = "42"');
  });

  it('gives partial credit by weight and names what was missing', async () => {
    const result = await gradeTrial(
      task(
        [
          { name: 'a', type: 'contains', target: answer, value: 'alpha', caseSensitive: false, weight: 3, required: false },
          { name: 'b', type: 'contains', target: answer, value: 'beta', caseSensitive: false, weight: 1, required: false },
        ],
        0.75,
      ),
      { finalText: 'alpha only', workspaceDir: workspace },
    );
    expect(result.score).toBe(0.75);
    expect(result.passed).toBe(true);
    expect(result.checks[1].reason).toContain('"beta" not found in the final answer');
  });

  it('fails the trial when a required check fails even if the score clears the threshold', async () => {
    const result = await gradeTrial(
      task(
        [
          { name: 'must', type: 'contains', target: answer, value: 'zzz', caseSensitive: false, weight: 1, required: true },
          { name: 'easy', type: 'contains', target: answer, value: 'a', caseSensitive: false, weight: 9, required: false },
        ],
        0.5,
      ),
      { finalText: 'a', workspaceDir: workspace },
    );
    expect(result.score).toBe(0.9);
    expect(result.passed).toBe(false);
  });

  it('reports missing files, malformed JSON and path escapes as failures, not crashes', async () => {
    const result = await gradeTrial(
      task([
        { name: 'missing', type: 'contains', target: { kind: 'file', path: 'nope.md' }, value: 'x', caseSensitive: false, weight: 1, required: false },
        { name: 'escape', type: 'contains', target: { kind: 'file', path: '../../etc/passwd' }, value: 'root', caseSensitive: false, weight: 1, required: false },
        { name: 'json', type: 'json', target: answer, field: 'a', equals: 1, weight: 1, required: false },
      ]),
      { finalText: '{not json', workspaceDir: workspace },
    );
    expect(result.checks.map((c) => c.passed)).toEqual([false, false, false]);
    expect(result.checks[0].reason).toBe('File nope.md was not created');
    expect(result.checks[2].reason).toContain('No parseable JSON');
  });

  it('runs script checks through the injected runner', async () => {
    const result = await gradeTrial(
      task([{ name: 'hidden test', type: 'script', language: 'bash', code: 'exit 0', weight: 1, required: false }]),
      { finalText: '', workspaceDir: workspace },
      async () => ({ passed: false, output: 'AssertionError: expected 3 got 2' }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks[0].reason).toBe('Hidden test failed: AssertionError: expected 3 got 2');
  });

  it('leads a failed script reason with the final line of a traceback', async () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "/tmp/grader-x/check.py", line 9, in <module>',
      '    assert not missing, f"missing {missing}"',
      "AssertionError: missing ['C-206']",
    ].join('\n');
    const result = await gradeTrial(
      task([{ name: 'hidden test', type: 'script', language: 'python', code: 'x', weight: 1, required: false }]),
      { finalText: '', workspaceDir: workspace },
      async () => ({ passed: false, output: traceback }),
    );
    const reason = result.checks[0].reason;
    expect(reason.startsWith("Hidden test failed: AssertionError: missing ['C-206']\n\nTraceback")).toBe(true);
  });
});

describe('runScriptCheck', () => {
  it('runs in the workspace and maps exit codes to pass/fail', async () => {
    const pass = await runScriptCheck({ name: 's', type: 'script', language: 'bash', code: 'grep -q "fix #42" NOTES.md && echo ok', weight: 1, required: false }, workspace);
    expect(pass).toEqual({ passed: true, output: 'ok\n' });
    const fail = await runScriptCheck({ name: 's', type: 'script', language: 'bash', code: 'echo nope >&2; exit 3', weight: 1, required: false }, workspace);
    expect(fail.passed).toBe(false);
    expect(fail.output).toContain('nope');
  });
});

describe('helpers', () => {
  it('extracts JSON from fences, bare documents and embedded objects', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('{"a":2}')).toEqual({ a: 2 });
    expect(extractJson('Result: {"a": {"b": "}"}} done')).toEqual({ a: { b: '}' } });
    expect(extractJson('nothing here')).toBeUndefined();
  });

  it('reads dot paths including array indexes', () => {
    expect(getPath({ items: [{ id: 'x' }] }, 'items.0.id')).toBe('x');
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('scores zero-weight edge cases safely', () => {
    expect(scoreChecks([], 1)).toEqual({ score: 0, passed: false });
  });
});
