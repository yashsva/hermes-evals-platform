import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Arm,
  ConfigSpec,
  CostEstimate,
  CreateExperimentInput,
  Definition,
  ExperimentDetail,
  ExperimentSummary,
  TaskSpec,
  TrialDetail,
  TrialRow,
  TrialStatus,
} from '@evals/shared';
import { env } from '../common/env';
import { parseOrThrow } from '../common/validation';
import { DefinitionsRepository } from '../definitions/definitions.repository';
import { costUsd, ModelPrice, PricingService } from '../pricing/pricing.service';
import { AgentAdapter } from '../runner/agent-adapter';
import { aggregate } from '../stats/aggregate';
import { ExperimentRow, ExperimentsRepository, TrialRowDb } from './experiments.repository';

/** Used for estimates until a model has at least 5 finished trials of history. */
const DEFAULT_TOKENS_PER_TRIAL = { tokensIn: 15_000, tokensOut: 1_500 };

const ALL_STATUSES: TrialStatus[] = ['queued', 'running', 'passed', 'failed', 'error', 'skipped'];

interface ResolvedPlan {
  input: CreateExperimentInput;
  configA: Definition<'config'>;
  configB: Definition<'config'>;
  tasks: Definition<'task'>[];
  skillIds: Record<Arm, number[]>;
  prices: Record<string, ModelPrice>;
  estimate: CostEstimate;
}

@Injectable()
export class ExperimentsService {
  constructor(
    private readonly repo: ExperimentsRepository,
    private readonly definitions: DefinitionsRepository,
    private readonly pricing: PricingService,
    private readonly adapter: AgentAdapter,
  ) {}

  async estimate(body: unknown): Promise<CostEstimate> {
    return (await this.resolve(body)).estimate;
  }

  /** Validates, prices and creates an experiment. Refuses to start if the estimate exceeds the spend cap. */
  async create(body: unknown): Promise<{ id: number }> {
    const plan = await this.resolve(body);
    const { estimate, input } = plan;
    const needsOpenRouter = [plan.configA, plan.configB].some((c) => c.spec.provider === 'openrouter');
    if (env.runner === 'hermes' && needsOpenRouter && !process.env.OPENROUTER_API_KEY) {
      throw new BadRequestException('OPENROUTER_API_KEY is not set. Add it to .env and restart (docker compose up -d).');
    }
    if (env.runner === 'hermes' && estimate.missingPrices.length > 0) {
      throw new BadRequestException(
        `No price found for ${estimate.missingPrices.join(', ')} on OpenRouter, so the spend cap can't be enforced. Use a model id from openrouter.ai/models.`,
      );
    }
    if (estimate.estimatedUsd !== null && estimate.estimatedUsd > input.spendCapUsd) {
      throw new BadRequestException(
        `Estimated cost $${estimate.estimatedUsd.toFixed(2)} exceeds the $${input.spendCapUsd.toFixed(2)} spend cap. Use fewer tasks/repeats, a cheaper model, or raise the cap.`,
      );
    }
    const id = await this.repo.create({
      name: input.name,
      configAId: plan.configA.id,
      configBId: plan.configB.id,
      taskIds: plan.tasks.map((t) => t.id),
      skillIds: plan.skillIds,
      repeats: input.repeats,
      spendCapUsd: input.spendCapUsd,
      hermesVersion: await this.adapter.version(),
      prices: plan.prices,
      estimate,
    });
    return { id };
  }

  async list(): Promise<ExperimentSummary[]> {
    const rows = await this.repo.list();
    const configs = await this.definitionsById(rows.flatMap((r) => [r.config_a_id, r.config_b_id]));
    return rows.map((row) => this.summary(row, configs, row.spent_usd, row.counts));
  }

  async detail(id: number): Promise<ExperimentDetail> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException(`Experiment ${id} not found`);
    const trials = await this.repo.trials(id);
    const defs = await this.definitionsById([row.config_a_id, row.config_b_id, ...row.task_ids, ...row.skill_ids.A, ...row.skill_ids.B]);
    const configA = defs.get(row.config_a_id) as Definition<'config'>;
    const configB = defs.get(row.config_b_id) as Definition<'config'>;
    const tasks = row.task_ids.map((tid) => defs.get(tid) as Definition<'task'>);
    const skillIds = [...new Set([...row.skill_ids.A, ...row.skill_ids.B])];

    const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<TrialStatus, number>;
    for (const t of trials) counts[t.status]++;
    const spent = trials.reduce((s, t) => s + (t.cost_usd ?? 0), 0);

    const labelA = this.armLabel(configA, 'A');
    const labelB = configA.id === configB.id ? `${this.armLabel(configB, 'B')} (same config)` : this.armLabel(configB, 'B');
    const stats = aggregate(
      trials.map((t) => ({
        taskId: t.task_id,
        arm: t.arm,
        status: t.status,
        score: t.score,
        tokensIn: t.tokens_in,
        tokensOut: t.tokens_out,
        costUsd: t.cost_usd,
        durationMs: t.duration_ms,
      })),
      tasks.map((t) => ({ id: t.id, key: t.key, name: t.name, tags: (t.spec as TaskSpec).tags })),
      { a: labelA, b: labelB },
    );

    return {
      ...this.summary(row, defs, spent, counts),
      hermesVersion: row.hermes_version,
      configASpec: configA,
      configBSpec: configB,
      skills: skillIds.map((sid) => defs.get(sid) as Definition<'skill'>),
      tasks: tasks.map(({ id: tid, key, version, name }) => ({ id: tid, key, version, name })),
      estimate: row.estimate,
      prices: row.prices,
      ...stats,
      trials: trials.map((t) => this.trialRow(t, defs)),
    };
  }

  async trial(id: number): Promise<TrialDetail> {
    const t = await this.repo.trial(id);
    if (!t) throw new NotFoundException(`Trial ${id} not found`);
    const defs = await this.definitionsById([t.task_id, t.config_id]);
    const [events, checks] = await Promise.all([this.repo.events(id), this.repo.checks(id)]);
    return {
      ...this.trialRow(t, defs),
      experimentId: t.experiment_id,
      configId: t.config_id,
      task: defs.get(t.task_id) as Definition<'task'>,
      config: defs.get(t.config_id) as Definition<'config'>,
      finalText: t.final_text,
      exitCode: t.exit_code,
      tokensIn: t.tokens_in,
      tokensOut: t.tokens_out,
      attempts: t.attempts,
      stderrTail: t.stderr_tail,
      checks,
      events,
      startedAt: t.started_at?.toISOString() ?? null,
      finishedAt: t.finished_at?.toISOString() ?? null,
    };
  }

  async cancel(id: number): Promise<void> {
    if (!(await this.repo.findById(id))) throw new NotFoundException(`Experiment ${id} not found`);
    await this.repo.cancel(id);
  }

  // ---- helpers ----

  private async resolve(body: unknown): Promise<ResolvedPlan> {
    const input = parseOrThrow(CreateExperimentInput, body);
    const taskIds = [...new Set(input.taskIds)];
    const defs = await this.definitionsById([input.configAId, input.configBId, ...taskIds]);

    const config = (id: number, field: string): Definition<'config'> => {
      const def = defs.get(id);
      if (!def || def.kind !== 'config') throw this.issue(field, `Config ${id} not found`);
      if (def.archived) throw this.issue(field, `Config "${def.key}" is archived`);
      return def as Definition<'config'>;
    };
    const configA = config(input.configAId, 'configAId');
    const configB = config(input.configBId, 'configBId');

    const tasks = taskIds.map((id) => {
      const def = defs.get(id);
      if (!def || def.kind !== 'task') throw this.issue('taskIds', `Task ${id} not found`);
      if (def.archived) throw this.issue('taskIds', `Task "${def.key}" is archived`);
      return def as Definition<'task'>;
    });

    const skillIds = { A: await this.resolveSkills(configA.spec), B: await this.resolveSkills(configB.spec) };
    const models = [...new Set([configA.spec.model, configB.spec.model])];
    const prices = await this.pricing.priceFor(models);
    const trials = tasks.length * 2 * input.repeats;

    let total = 0;
    let basis: CostEstimate['basis'] = 'default';
    const missingPrices = models.filter((m) => !prices[m]);
    for (const spec of [configA.spec, configB.spec]) {
      const history = await this.repo.averageTokens(spec.model);
      if (history) basis = 'history';
      const tokens = history ?? DEFAULT_TOKENS_PER_TRIAL;
      total += (costUsd(prices[spec.model], tokens.tokensIn, tokens.tokensOut) ?? 0) * tasks.length * input.repeats;
    }
    const known = missingPrices.length === 0;
    const estimate: CostEstimate = {
      trials,
      estimatedUsd: known ? total : null,
      perTrialUsd: known ? total / trials : null,
      basis,
      missingPrices,
    };
    return { input: { ...input, taskIds }, configA, configB, tasks, skillIds, prices, estimate };
  }

  /** Skill keys in a config resolve to their latest active version at experiment creation, then stay pinned. */
  private async resolveSkills(spec: ConfigSpec): Promise<number[]> {
    const ids: number[] = [];
    for (const key of spec.skills) {
      const skill = await this.definitions.findLatest('skill', key);
      if (!skill || skill.archived) throw this.issue('config', `Skill "${key}" is missing or archived`);
      ids.push(skill.id);
    }
    return ids;
  }

  private issue(path: string, message: string): BadRequestException {
    return new BadRequestException({ message: 'Validation failed', issues: [{ path, message }] });
  }

  private async definitionsById(ids: number[]): Promise<Map<number, Definition>> {
    const defs = await this.definitions.findByIds([...new Set(ids)]);
    return new Map(defs.map((d) => [d.id, d]));
  }

  private armLabel(config: Definition, arm: Arm): string {
    return `${arm} (${config.name})`;
  }

  private summary(
    row: ExperimentRow,
    defs: Map<number, Definition>,
    spent: number,
    counts: Partial<Record<TrialStatus, number>>,
  ): ExperimentSummary {
    const ref = (id: number) => {
      const d = defs.get(id);
      return { id, key: d?.key ?? '?', version: d?.version ?? 0, name: d?.name ?? '?' };
    };
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      configA: ref(row.config_a_id),
      configB: ref(row.config_b_id),
      repeats: row.repeats,
      spendCapUsd: row.spend_cap_usd,
      spentUsd: spent,
      counts: Object.fromEntries(ALL_STATUSES.map((s) => [s, counts[s] ?? 0])) as Record<TrialStatus, number>,
      createdAt: row.created_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null,
    };
  }

  private trialRow(t: TrialRowDb, defs: Map<number, Definition>): TrialRow {
    return {
      id: t.id,
      taskId: t.task_id,
      taskKey: defs.get(t.task_id)?.key ?? '?',
      arm: t.arm,
      repeat: t.repeat,
      status: t.status,
      score: t.score,
      costUsd: t.cost_usd,
      durationMs: t.duration_ms,
      error: t.error,
    };
  }
}
