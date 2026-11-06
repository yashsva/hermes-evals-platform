import { Logger } from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';
import { env } from '../common/env';
import { AgentAdapter, AgentRunRequest, AgentRunResult } from './agent-adapter';
import { killProcessesWithHome } from './process-reaper';
import { isProviderError, parseStreamJson } from './stream-json';

const STDERR_TAIL_CHARS = 4000;
const KILL_GRACE_MS = 5000;

/**
 * Runs one trial as `hermes chat -q … --format stream-json` in its own HERMES_HOME and workspace.
 * Hermes picks one-shot mode automatically because stdio is not a TTY.
 */
export class HermesCliAdapter extends AgentAdapter {
  readonly name = 'hermes';
  private readonly logger = new Logger(HermesCliAdapter.name);
  private cachedVersion: string | undefined;

  constructor(private readonly bin = env.hermesBin) {
    super();
  }

  async version(): Promise<string> {
    if (this.cachedVersion) return this.cachedVersion;
    this.cachedVersion = await new Promise<string>((resolve) => {
      execFile(this.bin, ['--version'], { timeout: 30_000 }, (err, stdout) => {
        resolve(err ? 'unknown' : (stdout.split('\n')[0]?.trim() || 'unknown'));
      });
    });
    return this.cachedVersion;
  }

  buildArgs(request: AgentRunRequest): string[] {
    const { config, task } = request;
    const args = [
      'chat',
      '-q', task.prompt,
      '--format', 'stream-json',
      '-m', config.model,
      '--provider', config.provider,
      '-t', config.toolsets.join(','),
      '--max-turns', String(config.maxTurns),
      // Trials are unattended; there is nobody to approve a command. The container is the sandbox.
      '--yolo',
    ];
    for (const skill of request.skills) args.push('-s', skill.key);
    return args;
  }

  run(request: AgentRunRequest): Promise<AgentRunResult> {
    const started = Date.now();
    const { DATABASE_URL: _db, ...inherited } = process.env;
    const child = spawn(this.bin, this.buildArgs(request), {
      cwd: request.workspaceDir,
      env: { ...inherited, HERMES_HOME: request.homeDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so a timeout also kills any shell commands the agent started.
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS * 4);
    });

    let timedOut = false;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS).unref();
    }, request.timeoutMs);

    return new Promise<AgentRunResult>((resolve) => {
      const finish = (exitCode: number | null, spawnError?: Error) => {
        clearTimeout(timer);
        const parsed = parseStreamJson(stdout);
        const durationMs = Date.now() - started;
        const stderrTail = stderr.slice(-STDERR_TAIL_CHARS);
        const base = {
          events: parsed.events,
          finalText: parsed.result?.text ?? '',
          exitCode,
          tokens: parsed.result?.tokens ?? { input: 0, output: 0, cacheRead: 0 },
          durationMs,
          stderrTail,
        };
        if (spawnError) {
          return resolve({ ...base, error: `Could not start Hermes: ${spawnError.message}`, errorKind: 'spawn' });
        }
        if (timedOut) {
          return resolve({ ...base, error: `Timed out after ${Math.round(request.timeoutMs / 1000)}s`, errorKind: 'timeout' });
        }
        if (!parsed.result) {
          return resolve({ ...base, error: `Hermes exited (${exitCode}) without a result event`, errorKind: 'no_result' });
        }
        const error = parsed.result.error ?? (exitCode === 0 ? null : `Hermes exited with code ${exitCode}`);
        if (!error) return resolve({ ...base, error: null, errorKind: null });
        const providerFault = isProviderError(`${error}\n${stderrTail}`);
        // Failing before any model call (no tokens) means setup/credentials, not agent behaviour.
        const neverRan = parsed.result.tokens.input === 0 && parsed.result.tokens.output === 0;
        resolve({ ...base, error, errorKind: providerFault ? 'provider' : neverRan ? 'setup' : 'agent' });
      };
      child.on('error', (err) => {
        this.logger.error(`spawn failed: ${err.message}`);
        finish(null, err);
      });
      // Kill the gateway daemon this chat left behind before the trial directory is removed.
      child.on('close', (code) => {
        void killProcessesWithHome(request.homeDir)
          .then((pids) => pids.length && this.logger.debug(`killed ${pids.length} leftover process(es)`))
          .finally(() => finish(code));
      });
    });
  }
}
