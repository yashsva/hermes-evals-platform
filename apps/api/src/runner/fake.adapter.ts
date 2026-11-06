import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mulberry32 } from '../stats/stats';
import { AgentAdapter, AgentRunRequest, AgentRunResult } from './agent-adapter';

/**
 * Simulates Hermes for UI development and $0 end-to-end tests (RUNNER=fake). It "solves" a task by
 * echoing the values its checks look for, with a success probability that is higher when skills are
 * preloaded. Deterministic per trial id. Its results are NEVER evidence.
 */
export class FakeAdapter extends AgentAdapter {
  readonly name = 'fake';

  constructor(private readonly delayMs = 300) {
    super();
  }

  async version(): Promise<string> {
    return 'fake-adapter (simulated runs, not evidence)';
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const random = mulberry32(request.trialId * 7919);
    await new Promise((r) => setTimeout(r, this.delayMs));
    const successRate = request.skills.length > 0 ? 0.8 : 0.5;

    const answerParts: string[] = [];
    const events: AgentRunResult['events'] = [
      { type: 'system', payload: { subtype: 'init', model: `${request.config.model} (fake)`, session_id: `fake-${request.trialId}` } },
    ];

    for (const file of request.task.files.slice(0, 1)) {
      events.push({ type: 'tool_use', payload: { name: 'read_file', input: { path: file.path } } });
      events.push({ type: 'tool_result', payload: { name: 'read_file', output: file.content.slice(0, 200), duration_ms: 12, is_error: false } });
    }

    for (const check of request.task.checks) {
      if (random() > successRate) continue;
      const fragment = check.type === 'contains' ? check.value : check.type === 'json' ? JSON.stringify({ [check.field]: check.equals }) : '';
      if (!fragment) continue;
      if (check.type !== 'script' && check.target.kind === 'file') {
        const path = join(request.workspaceDir, check.target.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, fragment, { flag: 'a' });
        events.push({ type: 'tool_use', payload: { name: 'write_file', input: { path: check.target.path } } });
        events.push({ type: 'tool_result', payload: { name: 'write_file', output: 'ok', duration_ms: 5, is_error: false } });
      } else {
        answerParts.push(fragment);
      }
    }

    const finalText = answerParts.length ? answerParts.join('\n') : 'I could not complete this task.';
    const tokens = { input: 4000 + Math.floor(random() * 6000), output: 200 + Math.floor(random() * 800), cacheRead: 0 };
    events.push({ type: 'text', payload: { text: finalText } });
    events.push({ type: 'result', payload: { exit_code: 0, text: finalText, tokens, duration_ms: this.delayMs } });

    return { events, finalText, exitCode: 0, tokens, durationMs: this.delayMs, error: null, errorKind: null, stderrTail: '' };
  }
}
