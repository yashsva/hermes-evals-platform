import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigSpec, Definition, SkillSpec, TaskSpec } from '@evals/shared';
import { env } from '../common/env';
import { DefinitionsRepository } from '../definitions/definitions.repository';
import { ExperimentsRepository, TrialOutcome, TrialRowDb } from '../experiments/experiments.repository';
import { gradeTrial } from '../grading/grading';
import { costUsd } from '../pricing/pricing.service';
import { AgentAdapter, AgentRunResult } from './agent-adapter';
import { prepareTrialDirs, removeTrialDirs, trialDirs } from './trial-dirs';

const POLL_MS = 1000;

/** Errors where the run produced no usable answer: score 0, no grading. */
const HARD_ERRORS = new Set(['timeout', 'no_result', 'spawn', 'provider', 'setup']);

/**
 * In-process worker. The trials table is the queue: each tick claims queued trials (SKIP LOCKED)
 * up to WORKER_CONCURRENCY, runs them, grades them and stores the outcome. Durable across restarts
 * because all state lives in Postgres.
 */
@Injectable()
export class RunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RunnerService.name);
  private readonly active = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopping = false;

  constructor(
    private readonly experiments: ExperimentsRepository,
    private readonly definitions: DefinitionsRepository,
    private readonly adapter: AgentAdapter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const orphans = await this.experiments.requeueOrphans();
    if (orphans) this.logger.warn(`Re-queued ${orphans} trial(s) interrupted by a restart`);
    this.logger.log(`Runner: ${this.adapter.name} (${await this.adapter.version()}), concurrency ${env.concurrency}`);
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(this.active);
  }

  /** One scheduling pass. Public so tests can drive the queue deterministically. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      const stopped = await this.experiments.enforceBudgets();
      for (const id of stopped) this.logger.warn(`Experiment ${id} reached its spend cap; remaining trials skipped`);
      while (this.active.size < env.concurrency) {
        const trial = await this.experiments.claimNext();
        if (!trial) break;
        const job = this.execute(trial).finally(() => this.active.delete(job));
        this.active.add(job);
      }
    } catch (err) {
      this.logger.error(`Scheduler error: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Waits for in-flight trials (tests). */
  async drain(): Promise<void> {
    while (this.active.size) await Promise.allSettled(this.active);
  }

  private async execute(trial: TrialRowDb): Promise<void> {
    const dirs = trialDirs(env.trialsRoot, trial.id);
    try {
      const experiment = await this.experiments.findById(trial.experiment_id);
      if (!experiment) return;
      const [task, config, skills] = await Promise.all([
        this.definitions.findById(trial.task_id) as Promise<Definition<'task'>>,
        this.definitions.findById(trial.config_id) as Promise<Definition<'config'>>,
        this.definitions.findByIds(experiment.skill_ids[trial.arm]) as Promise<Definition<'skill'>[]>,
      ]);
      const taskSpec = task.spec as TaskSpec;
      const configSpec = config.spec as ConfigSpec;
      const skillSpecs = skills.map((s) => ({ key: s.key, spec: s.spec as SkillSpec }));

      await prepareTrialDirs(dirs, taskSpec, configSpec, skillSpecs);
      const run = await this.adapter.run({
        trialId: trial.id,
        task: taskSpec,
        config: configSpec,
        skills: skillSpecs,
        homeDir: dirs.home,
        workspaceDir: dirs.workspace,
        timeoutMs: taskSpec.timeoutSec * 1000,
      });

      if (run.errorKind === 'provider' && trial.attempts < env.maxAttempts) {
        this.logger.warn(`Trial ${trial.id}: provider error, retrying (${run.error})`);
        await this.experiments.requeue(trial.id, `retrying after: ${run.error}`);
        return;
      }

      const outcome = await this.outcome(run, taskSpec, dirs.workspace, costUsd(experiment.prices[configSpec.model], run.tokens.input, run.tokens.output));
      await this.experiments.saveOutcome(trial.id, outcome);
      this.logger.log(`Trial ${trial.id} [${trial.arm}] ${task.key}#${trial.repeat}: ${outcome.status} score=${outcome.score.toFixed(2)}`);
    } catch (err) {
      this.logger.error(`Trial ${trial.id} crashed: ${(err as Error).stack}`);
      await this.experiments.saveOutcome(trial.id, crashOutcome((err as Error).message)).catch(() => undefined);
    } finally {
      if (!env.keepTrialDirs) await removeTrialDirs(dirs).catch(() => undefined);
      await this.experiments.completeIfDone(trial.experiment_id).catch(() => undefined);
    }
  }

  private async outcome(run: AgentRunResult, task: TaskSpec, workspace: string, cost: number | null): Promise<TrialOutcome> {
    const base = {
      finalText: run.finalText,
      exitCode: run.exitCode,
      tokensIn: run.tokens.input,
      tokensOut: run.tokens.output,
      tokensCacheRead: run.tokens.cacheRead,
      costUsd: cost,
      durationMs: run.durationMs,
      error: run.error,
      stderrTail: run.stderrTail,
      events: run.events,
    };
    // Crashes and timeouts score 0 and stay in the denominator: dropping them would flatter the flakier config.
    if (run.errorKind && HARD_ERRORS.has(run.errorKind)) {
      return { ...base, status: 'error', score: 0, checks: [] };
    }
    // A run that ended with an agent-side error (e.g. hit max turns) may still have done the work — grade it.
    const graded = await gradeTrial(task, { finalText: run.finalText, workspaceDir: workspace });
    return { ...base, status: graded.passed ? 'passed' : 'failed', score: graded.score, checks: graded.checks };
  }
}

function crashOutcome(message: string): TrialOutcome {
  return {
    status: 'error',
    score: 0,
    finalText: '',
    exitCode: null,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    costUsd: null,
    durationMs: 0,
    error: `Platform error: ${message}`,
    stderrTail: '',
    events: [],
    checks: [],
  };
}
