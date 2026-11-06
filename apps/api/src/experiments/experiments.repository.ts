import { Injectable } from '@nestjs/common';
import { Arm, CheckResult, CostEstimate, ExperimentStatus, TrialEvent, TrialStatus } from '@evals/shared';
import { DbService } from '../db/db.service';
import { ModelPrice } from '../pricing/pricing.service';
import { ParsedEvent } from '../runner/stream-json';

export interface ExperimentRow {
  id: number;
  name: string;
  status: ExperimentStatus;
  config_a_id: number;
  config_b_id: number;
  task_ids: number[];
  skill_ids: Record<Arm, number[]>;
  repeats: number;
  spend_cap_usd: number;
  hermes_version: string;
  prices: Record<string, ModelPrice>;
  estimate: CostEstimate | null;
  created_at: Date;
  finished_at: Date | null;
}

export interface TrialRowDb {
  id: number;
  experiment_id: number;
  task_id: number;
  config_id: number;
  arm: Arm;
  repeat: number;
  status: TrialStatus;
  attempts: number;
  score: number | null;
  final_text: string | null;
  exit_code: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error: string | null;
  stderr_tail: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface NewExperiment {
  name: string;
  configAId: number;
  configBId: number;
  taskIds: number[];
  skillIds: Record<Arm, number[]>;
  repeats: number;
  spendCapUsd: number;
  hermesVersion: string;
  prices: Record<string, ModelPrice>;
  estimate: CostEstimate;
}

export interface TrialOutcome {
  status: TrialStatus;
  score: number;
  finalText: string;
  exitCode: number | null;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  costUsd: number | null;
  durationMs: number;
  error: string | null;
  stderrTail: string;
  events: ParsedEvent[];
  checks: CheckResult[];
}

@Injectable()
export class ExperimentsRepository {
  constructor(private readonly db: DbService) {}

  /** Creates the experiment and its full trial matrix (arms × tasks × repeats) atomically. */
  async create(input: NewExperiment): Promise<number> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO experiments (name, config_a_id, config_b_id, task_ids, skill_ids, repeats, spend_cap_usd, hermes_version, prices, estimate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          input.name,
          input.configAId,
          input.configBId,
          input.taskIds,
          JSON.stringify(input.skillIds),
          input.repeats,
          input.spendCapUsd,
          input.hermesVersion,
          JSON.stringify(input.prices),
          JSON.stringify(input.estimate),
        ],
      );
      const experimentId = rows[0].id;
      await client.query(
        `INSERT INTO trials (experiment_id, task_id, config_id, arm, repeat)
         SELECT $1, task_id, CASE arm WHEN 'A' THEN $2::int ELSE $3::int END, arm, rep
         FROM unnest($4::int[]) AS task_id,
              unnest(ARRAY['A', 'B']) AS arm,
              generate_series(1, $5::int) AS rep`,
        [experimentId, input.configAId, input.configBId, input.taskIds, input.repeats],
      );
      return experimentId;
    });
  }

  findById(id: number): Promise<ExperimentRow | undefined> {
    return this.db.one<ExperimentRow>('SELECT * FROM experiments WHERE id = $1', [id]);
  }

  list(): Promise<(ExperimentRow & { spent_usd: number; counts: Record<string, number> })[]> {
    return this.db.query(
      `SELECT e.*,
              COALESCE((SELECT sum(cost_usd) FROM trials t WHERE t.experiment_id = e.id), 0) AS spent_usd,
              COALESCE((SELECT jsonb_object_agg(status, n) FROM (
                 SELECT status, count(*)::int AS n FROM trials t WHERE t.experiment_id = e.id GROUP BY status) s), '{}') AS counts
       FROM experiments e ORDER BY e.id DESC`,
    );
  }

  trials(experimentId: number): Promise<TrialRowDb[]> {
    return this.db.query<TrialRowDb>('SELECT * FROM trials WHERE experiment_id = $1 ORDER BY task_id, arm, repeat', [experimentId]);
  }

  trial(id: number): Promise<TrialRowDb | undefined> {
    return this.db.one<TrialRowDb>('SELECT * FROM trials WHERE id = $1', [id]);
  }

  events(trialId: number): Promise<TrialEvent[]> {
    return this.db.query<TrialEvent>('SELECT seq, type, payload FROM trial_events WHERE trial_id = $1 ORDER BY seq', [trialId]);
  }

  checks(trialId: number): Promise<CheckResult[]> {
    return this.db.query<CheckResult>(
      'SELECT name, type, weight, required, passed, reason FROM checks WHERE trial_id = $1 ORDER BY position',
      [trialId],
    );
  }

  /** Average tokens per finished trial for a model, used for cost estimates once history exists. */
  async averageTokens(model: string): Promise<{ tokensIn: number; tokensOut: number; n: number } | undefined> {
    const row = await this.db.one<{ tokens_in: number | null; tokens_out: number | null; n: number }>(
      `SELECT avg(t.tokens_in)::float AS tokens_in, avg(t.tokens_out)::float AS tokens_out, count(*)::int AS n
       FROM trials t
       JOIN definitions d ON d.id = t.config_id
       JOIN experiments e ON e.id = t.experiment_id
       WHERE d.spec->>'model' = $1 AND t.status IN ('passed', 'failed') AND t.tokens_in > 0
         AND e.hermes_version NOT LIKE 'fake%'`,
      [model],
    );
    if (!row || row.n < 5 || row.tokens_in === null || row.tokens_out === null) return undefined;
    return { tokensIn: row.tokens_in, tokensOut: row.tokens_out, n: row.n };
  }

  async cancel(id: number): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE experiments SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status IN ('queued', 'running')`,
        [id],
      );
      await client.query(`UPDATE trials SET status = 'skipped' WHERE experiment_id = $1 AND status = 'queued'`, [id]);
    });
  }

  // ---- queue operations used by the runner ----

  /** Trials left 'running' by a crash or restart go back to the queue. */
  async requeueOrphans(): Promise<number> {
    const rows = await this.db.query(`UPDATE trials SET status = 'queued' WHERE status = 'running' RETURNING id`);
    return rows.length;
  }

  /** Stops experiments that reached their spend cap; their queued trials become 'skipped'. */
  async enforceBudgets(): Promise<number[]> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `UPDATE experiments e SET status = 'budget_stopped', finished_at = now()
         WHERE e.status IN ('queued', 'running')
           AND (SELECT COALESCE(sum(cost_usd), 0) FROM trials t WHERE t.experiment_id = e.id) >= e.spend_cap_usd
         RETURNING id`,
      );
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        await client.query(`UPDATE trials SET status = 'skipped' WHERE experiment_id = ANY($1::int[]) AND status = 'queued'`, [ids]);
      }
      return ids;
    });
  }

  /** Atomically claims the next queued trial. SKIP LOCKED makes this safe with several workers. */
  async claimNext(): Promise<TrialRowDb | undefined> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<TrialRowDb>(
        `UPDATE trials SET status = 'running', attempts = attempts + 1, started_at = now()
         WHERE id = (
           SELECT t.id FROM trials t JOIN experiments e ON e.id = t.experiment_id
           WHERE t.status = 'queued' AND e.status IN ('queued', 'running')
           ORDER BY e.id, t.order_key
           LIMIT 1 FOR UPDATE OF t SKIP LOCKED)
         RETURNING *`,
      );
      const trial = rows[0];
      if (trial) {
        await client.query(`UPDATE experiments SET status = 'running' WHERE id = $1 AND status = 'queued'`, [trial.experiment_id]);
      }
      return trial;
    });
  }

  async requeue(trialId: number, error: string): Promise<void> {
    await this.db.query(`UPDATE trials SET status = 'queued', error = $2 WHERE id = $1`, [trialId, error]);
  }

  async saveOutcome(trialId: number, outcome: TrialOutcome): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE trials SET status = $2, score = $3, final_text = $4, exit_code = $5, tokens_in = $6, tokens_out = $7,
                tokens_cache_read = $8, cost_usd = $9, duration_ms = $10, error = $11, stderr_tail = $12, finished_at = now()
         WHERE id = $1`,
        [
          trialId,
          outcome.status,
          outcome.score,
          outcome.finalText,
          outcome.exitCode,
          outcome.tokensIn,
          outcome.tokensOut,
          outcome.tokensCacheRead,
          outcome.costUsd,
          outcome.durationMs,
          outcome.error,
          outcome.stderrTail || null,
        ],
      );
      await client.query('DELETE FROM trial_events WHERE trial_id = $1', [trialId]);
      await client.query('DELETE FROM checks WHERE trial_id = $1', [trialId]);
      if (outcome.events.length) {
        await client.query(
          `INSERT INTO trial_events (trial_id, seq, type, payload)
           SELECT $1, ord::int, e->>'type', e->'payload' FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS x(e, ord)`,
          [trialId, JSON.stringify(outcome.events)],
        );
      }
      if (outcome.checks.length) {
        await client.query(
          `INSERT INTO checks (trial_id, position, name, type, weight, required, passed, reason)
           SELECT $1, ord::int, c->>'name', c->>'type', (c->>'weight')::float, (c->>'required')::boolean, (c->>'passed')::boolean, c->>'reason'
           FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS x(c, ord)`,
          [trialId, JSON.stringify(outcome.checks)],
        );
      }
    });
  }

  /** Marks the experiment completed once no trial is waiting or running. */
  async completeIfDone(experimentId: number): Promise<void> {
    await this.db.query(
      `UPDATE experiments SET status = 'completed', finished_at = now()
       WHERE id = $1 AND status = 'running'
         AND NOT EXISTS (SELECT 1 FROM trials WHERE experiment_id = $1 AND status IN ('queued', 'running'))`,
      [experimentId],
    );
  }
}
