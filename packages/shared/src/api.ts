import { z } from 'zod';
import { Definition } from './definitions';

export type ExperimentStatus = 'queued' | 'running' | 'completed' | 'budget_stopped' | 'cancelled';
export type TrialStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'skipped';
export type Arm = 'A' | 'B';
export type Verdict = 'better' | 'worse' | 'inconclusive' | 'insufficient_data';

export const CreateExperimentInput = z.object({
  name: z.string().min(1, 'Required').max(120),
  /** Definition ids (exact versions) of the two configs. They may be the same id (an A/A test). */
  configAId: z.number().int().positive(),
  configBId: z.number().int().positive(),
  taskIds: z.array(z.number().int().positive()).min(2, 'Pick at least 2 tasks'),
  repeats: z.number().int().min(1).max(10).default(3),
  spendCapUsd: z.number().positive().max(100).default(2),
});
export type CreateExperimentInput = z.infer<typeof CreateExperimentInput>;

export interface CostEstimate {
  trials: number;
  estimatedUsd: number | null;
  perTrialUsd: number | null;
  /** Where the per-trial token figure came from. */
  basis: 'history' | 'default';
  missingPrices: string[];
}

export interface ExperimentSummary {
  id: number;
  name: string;
  status: ExperimentStatus;
  configA: Pick<Definition, 'id' | 'key' | 'version' | 'name'>;
  configB: Pick<Definition, 'id' | 'key' | 'version' | 'name'>;
  repeats: number;
  spendCapUsd: number;
  spentUsd: number;
  counts: Record<TrialStatus, number>;
  createdAt: string;
  finishedAt: string | null;
}

export interface ArmStats {
  trials: number;
  meanScore: number;
  passRate: number;
  errors: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  medianDurationMs: number | null;
}

export interface TaskComparison {
  taskId: number;
  taskKey: string;
  taskName: string;
  tags: string[];
  scoresA: number[];
  scoresB: number[];
  meanA: number;
  meanB: number;
  delta: number;
}

export interface Comparison {
  verdict: Verdict;
  /** Mean over tasks of (mean B score − mean A score). */
  meanDelta: number;
  ciLow: number;
  ciHigh: number;
  confidence: number;
  resamples: number;
  tasksCompared: number;
  sentence: string;
}

export interface ExperimentDetail extends ExperimentSummary {
  hermesVersion: string;
  configASpec: Definition<'config'>;
  configBSpec: Definition<'config'>;
  skills: Definition<'skill'>[];
  tasks: Pick<Definition<'task'>, 'id' | 'key' | 'version' | 'name'>[];
  estimate: CostEstimate | null;
  prices: Record<string, { inputPerM: number; outputPerM: number }>;
  arms: Record<Arm, ArmStats>;
  perTask: TaskComparison[];
  /** Only present once every trial is terminal, so a half-finished run never shows a winner. */
  comparison: Comparison | null;
  trials: TrialRow[];
}

export interface TrialRow {
  id: number;
  taskId: number;
  taskKey: string;
  arm: Arm;
  repeat: number;
  status: TrialStatus;
  score: number | null;
  costUsd: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface TrialEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface CheckResult {
  name: string;
  type: string;
  weight: number;
  required: boolean;
  passed: boolean;
  reason: string;
}

export interface TrialDetail extends TrialRow {
  experimentId: number;
  configId: number;
  task: Definition<'task'>;
  config: Definition<'config'>;
  finalText: string | null;
  exitCode: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  attempts: number;
  stderrTail: string | null;
  checks: CheckResult[];
  events: TrialEvent[];
  startedAt: string | null;
  finishedAt: string | null;
}
