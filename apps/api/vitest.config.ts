import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests create and drop their own database on the compose Postgres (localhost:5433).
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://evals:evals@localhost:5433/evals_test',
      RUNNER: 'fake',
      TRIALS_ROOT: join(tmpdir(), 'agent-evals-test-trials'),
      WORKER_CONCURRENCY: '3',
    },
    fileParallelism: false,
  },
});
