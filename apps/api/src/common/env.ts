import { tmpdir } from 'node:os';
import { join } from 'node:path';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

/** All runtime configuration, read once. Secrets are only ever passed to the Hermes subprocess. */
export const env = {
  port: int('PORT', 3001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://evals:evals@localhost:5433/evals',
  /** `hermes` runs the real agent; `fake` simulates runs for UI development and tests. Never evidence. */
  runner: (process.env.RUNNER ?? 'hermes') as 'hermes' | 'fake',
  hermesBin: process.env.HERMES_BIN ?? 'hermes',
  /** Must be inside HERMES_WRITE_SAFE_ROOT (/opt/data) when running in the Hermes image. */
  trialsRoot: process.env.TRIALS_ROOT ?? join(tmpdir(), 'agent-evals-trials'),
  concurrency: int('WORKER_CONCURRENCY', 2),
  /** Retries for provider-side failures (rate limits, 5xx) before a trial counts as an error. */
  maxAttempts: int('MAX_ATTEMPTS', 2),
  keepTrialDirs: process.env.KEEP_TRIAL_DIRS === '1',
  webDist: process.env.WEB_DIST,
  seedOnEmpty: process.env.SEED !== '0',
};
