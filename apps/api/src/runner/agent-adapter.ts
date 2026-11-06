import { ConfigSpec, SkillSpec, TaskSpec } from '@evals/shared';
import { ParsedEvent } from './stream-json';

export interface AgentRunRequest {
  trialId: number;
  task: TaskSpec;
  config: ConfigSpec;
  skills: { key: string; spec: SkillSpec }[];
  homeDir: string;
  workspaceDir: string;
  timeoutMs: number;
}

/**
 * Why a run didn't complete normally. `provider` failures are retried; the rest are final.
 * `setup` = failed before any model call (e.g. missing credentials); `agent` = ran but ended badly (e.g. max turns).
 */
export type RunErrorKind = 'timeout' | 'provider' | 'no_result' | 'agent' | 'spawn' | 'setup';

export interface AgentRunResult {
  events: ParsedEvent[];
  finalText: string;
  exitCode: number | null;
  tokens: { input: number; output: number; cacheRead: number };
  durationMs: number;
  error: string | null;
  errorKind: RunErrorKind | null;
  stderrTail: string;
}

/** The only boundary between the platform and the agent harness. Swappable for tests and other harnesses. */
export abstract class AgentAdapter {
  abstract readonly name: string;
  abstract version(): Promise<string>;
  abstract run(request: AgentRunRequest): Promise<AgentRunResult>;
}
