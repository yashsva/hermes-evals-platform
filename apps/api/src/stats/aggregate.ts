import { Arm, ArmStats, Comparison, TaskComparison, TrialStatus } from '@evals/shared';
import { compareArms, mean, median } from './stats';

export interface TrialForStats {
  taskId: number;
  arm: Arm;
  status: TrialStatus;
  score: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  durationMs: number | null;
}

export interface TaskInfo {
  id: number;
  key: string;
  name: string;
  tags: string[];
}

const SCORED: TrialStatus[] = ['passed', 'failed', 'error'];
const TERMINAL: TrialStatus[] = [...SCORED, 'skipped'];

/**
 * Turns raw trials into the results page: per-arm totals, a paired per-task table and the verdict.
 * Errors count as score 0 and stay in the denominator; skipped trials (budget stop/cancel) are excluded.
 */
export function aggregate(
  trials: TrialForStats[],
  tasks: TaskInfo[],
  labels: { a: string; b: string },
): { arms: Record<Arm, ArmStats>; perTask: TaskComparison[]; comparison: Comparison | null } {
  const scored = trials.filter((t) => SCORED.includes(t.status));
  const arms = { A: armStats(scored.filter((t) => t.arm === 'A')), B: armStats(scored.filter((t) => t.arm === 'B')) };

  const perTask: TaskComparison[] = [];
  for (const task of tasks) {
    const scoresA = scored.filter((t) => t.taskId === task.id && t.arm === 'A').map((t) => t.score ?? 0);
    const scoresB = scored.filter((t) => t.taskId === task.id && t.arm === 'B').map((t) => t.score ?? 0);
    if (scoresA.length === 0 || scoresB.length === 0) continue;
    const meanA = mean(scoresA);
    const meanB = mean(scoresB);
    perTask.push({ taskId: task.id, taskKey: task.key, taskName: task.name, tags: task.tags, scoresA, scoresB, meanA, meanB, delta: meanB - meanA });
  }

  const allTerminal = trials.length > 0 && trials.every((t) => TERMINAL.includes(t.status));
  const comparison = allTerminal ? compareArms(perTask.map((t) => t.delta), labels) : null;
  return { arms, perTask, comparison };
}

function armStats(trials: TrialForStats[]): ArmStats {
  return {
    trials: trials.length,
    meanScore: mean(trials.map((t) => t.score ?? 0)),
    passRate: trials.length ? trials.filter((t) => t.status === 'passed').length / trials.length : 0,
    errors: trials.filter((t) => t.status === 'error').length,
    tokensIn: sum(trials.map((t) => t.tokensIn ?? 0)),
    tokensOut: sum(trials.map((t) => t.tokensOut ?? 0)),
    costUsd: sum(trials.map((t) => t.costUsd ?? 0)),
    medianDurationMs: median(trials.map((t) => t.durationMs).filter((d): d is number => d !== null)),
  };
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}
