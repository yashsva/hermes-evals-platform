/**
 * End-to-end through the real database with the FakeAdapter ($0): definitions CRUD and versioning,
 * experiment creation with cost guard, the queue/worker, grading and the results aggregate.
 * Requires the compose Postgres: `docker compose up -d db`.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from './common/env';
import { DbService } from './db/db.service';
import { DefinitionsRepository } from './definitions/definitions.repository';
import { DefinitionsService } from './definitions/definitions.service';
import { ExperimentsRepository } from './experiments/experiments.repository';
import { ExperimentsService } from './experiments/experiments.service';
import { ModelPrice, PricingService } from './pricing/pricing.service';
import { FakeAdapter } from './runner/fake.adapter';
import { RunnerService } from './runner/runner.service';

class FixedPricing extends PricingService {
  override async priceFor(models: string[]): Promise<Record<string, ModelPrice>> {
    return Object.fromEntries(models.map((m) => [m, { inputPerM: 1, outputPerM: 2 }]));
  }
}

async function recreateDatabase(): Promise<void> {
  const url = new URL(env.databaseUrl);
  const name = url.pathname.slice(1);
  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/evals' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
}

let db: DbService;
let definitions: DefinitionsService;
let experiments: ExperimentsService;
let runner: RunnerService;

beforeAll(async () => {
  await recreateDatabase();
  db = new DbService();
  await db.migrate();
  const defRepo = new DefinitionsRepository(db);
  const expRepo = new ExperimentsRepository(db);
  const adapter = new FakeAdapter(5);
  definitions = new DefinitionsService(defRepo);
  experiments = new ExperimentsService(expRepo, defRepo, new FixedPricing(), adapter);
  runner = new RunnerService(expRepo, defRepo, adapter);
});

afterAll(async () => {
  await db?.onModuleDestroy();
});

const taskBody = (key: string, value: string) => ({
  key,
  name: `Task ${key}`,
  spec: {
    prompt: `Say ${value}`,
    files: [{ path: 'in.txt', content: value }],
    checks: [{ name: 'says it', type: 'contains', target: { kind: 'answer' }, value }],
  },
});

describe('definitions', () => {
  it('creates, versions and archives without rewriting history', async () => {
    const v1 = await definitions.create('skill', { key: 'acme', name: 'ACME', spec: { description: 'd', body: 'v1 body' } });
    const v2 = await definitions.update('skill', 'acme', { name: 'ACME', spec: { description: 'd', body: 'v2 body' } });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect((await definitions.getById(v1.id)).spec).toEqual({ description: 'd', body: 'v1 body' });

    const { latest, versions } = await definitions.get('skill', 'acme');
    expect(latest.id).toBe(v2.id);
    expect(versions).toHaveLength(2);

    await definitions.create('skill', { key: 'old', name: 'Old', spec: { description: 'd', body: 'b' } });
    await definitions.setArchived('skill', 'old', true);
    expect((await definitions.list('skill', false)).map((d) => d.key)).toEqual(['acme']);
    expect((await definitions.list('skill', true)).map((d) => d.key)).toEqual(['acme', 'old']);
  });

  it('rejects invalid specs with field-level issues', async () => {
    await expect(definitions.create('task', { key: 'bad', name: 'Bad', spec: { prompt: '', checks: [] } })).rejects.toMatchObject({
      response: {
        issues: expect.arrayContaining([
          { path: 'spec.prompt', message: 'Required' },
          { path: 'spec.checks', message: 'Add at least one check' },
        ]),
      },
    });
    await expect(definitions.create('skill', { key: 'acme', name: 'Dup', spec: { description: 'd', body: 'b' } })).rejects.toThrow(/already exists/);
    await expect(
      definitions.create('config', { key: 'uses-old', name: 'C', spec: { model: 'test/model', skills: ['old'] } }),
    ).rejects.toMatchObject({ response: { issues: [{ path: 'spec.skills', message: 'Unknown or archived skill(s): old' }] } });
  });
});

describe('experiment lifecycle', () => {
  it('runs every trial, grades it, and produces a paired comparison', async () => {
    const base = await definitions.create('config', { key: 'base', name: 'Baseline', spec: { model: 'test/model' } });
    const skilled = await definitions.create('config', { key: 'skilled', name: 'With skill', spec: { model: 'test/model', skills: ['acme'] } });
    const tasks = await Promise.all(['alpha', 'beta', 'gamma', 'delta'].map((v) => definitions.create('task', taskBody(v, v.toUpperCase()))));

    const input = { name: 'skill ablation', configAId: base.id, configBId: skilled.id, taskIds: tasks.map((t) => t.id), repeats: 2, spendCapUsd: 1 };
    const estimate = await experiments.estimate(input);
    expect(estimate.trials).toBe(16);
    expect(estimate.estimatedUsd).toBeCloseTo(16 * (15_000 * 1 + 1_500 * 2) / 1e6);

    await expect(experiments.create({ ...input, spendCapUsd: 0.01 })).rejects.toThrow(/exceeds the \$0.01 spend cap/);

    const { id } = await experiments.create(input);
    let detail = await experiments.detail(id);
    expect(detail.counts.queued).toBe(16);
    expect(detail.comparison).toBeNull();

    for (let i = 0; i < 20 && (await experiments.detail(id)).status !== 'completed'; i++) {
      await runner.tick();
      await runner.drain();
    }

    detail = await experiments.detail(id);
    expect(detail.status).toBe('completed');
    expect(detail.counts.passed + detail.counts.failed).toBe(16);
    expect(detail.perTask).toHaveLength(4);
    expect(detail.comparison?.tasksCompared).toBe(4);
    expect(detail.spentUsd).toBeGreaterThan(0);
    expect(detail.skills.map((s) => s.version)).toEqual([2]); // pinned to the latest skill version at creation

    const trial = await experiments.trial(detail.trials[0].id);
    expect(trial.checks).toHaveLength(1);
    expect(trial.events.at(-1)?.type).toBe('result');
    expect(trial.task.key).toBe(detail.trials[0].taskKey);
  });

  it('supports A/A experiments (same config on both arms)', async () => {
    const base = (await definitions.get('config', 'base')).latest;
    const tasks = await definitions.list('task', false);
    const { id } = await experiments.create({ name: 'A/A', configAId: base.id, configBId: base.id, taskIds: tasks.map((t) => t.id), repeats: 1, spendCapUsd: 1 });
    for (let i = 0; i < 10 && (await experiments.detail(id)).status !== 'completed'; i++) {
      await runner.tick();
      await runner.drain();
    }
    const detail = await experiments.detail(id);
    expect(detail.status).toBe('completed');
    expect(detail.counts.passed + detail.counts.failed).toBe(8);
  });

  it('stops at the spend cap and skips the remaining trials', async () => {
    const base = (await definitions.get('config', 'base')).latest;
    const tasks = await definitions.list('task', false);
    // Each fake trial costs ≥ $0.0044 at the test prices, so a $0.005 cap stops after the first batch.
    const { id } = await experiments.create({ name: 'capped', configAId: base.id, configBId: base.id, taskIds: tasks.map((t) => t.id), repeats: 1, spendCapUsd: 1 });
    await db.query('UPDATE experiments SET spend_cap_usd = 0.005 WHERE id = $1', [id]);
    for (let i = 0; i < 5; i++) {
      await runner.tick();
      await runner.drain();
    }
    const detail = await experiments.detail(id);
    expect(detail.status).toBe('budget_stopped');
    expect(detail.counts.skipped).toBeGreaterThan(0);
    expect(detail.counts.queued).toBe(0);
  });
});
