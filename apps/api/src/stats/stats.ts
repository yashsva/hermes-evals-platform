import { Comparison, Verdict } from '@evals/shared';

/** Deterministic PRNG so the same data always yields the same interval (reproducible reports and tests). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linear-interpolated percentile (same definition as numpy's default), p in [0, 1]. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface BootstrapResult {
  mean: number;
  low: number;
  high: number;
}

/**
 * Percentile bootstrap CI for the mean of per-task deltas. We resample *tasks* (not trials):
 * repeats of one task are correlated, and the question is whether the effect holds across tasks like these.
 */
export function bootstrapMeanCi(deltas: number[], options: { resamples?: number; confidence?: number; seed?: number } = {}): BootstrapResult {
  const { resamples = 10_000, confidence = 0.95, seed = 42 } = options;
  const n = deltas.length;
  if (n === 0) return { mean: NaN, low: NaN, high: NaN };
  const random = mulberry32(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += deltas[Math.floor(random() * n)];
    means[r] = sum / n;
  }
  const sorted = Array.from(means).sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  return { mean: mean(deltas), low: percentile(sorted, alpha), high: percentile(sorted, 1 - alpha) };
}

/** Better/Worse only when the whole interval is on one side of zero. Tiny epsilon absorbs float noise. */
export function verdictFor(low: number, high: number, tasksCompared: number): Verdict {
  if (tasksCompared < 2 || Number.isNaN(low)) return 'insufficient_data';
  if (low > 1e-9) return 'better';
  if (high < -1e-9) return 'worse';
  return 'inconclusive';
}

export function compareArms(
  perTaskDeltas: number[],
  labels: { a: string; b: string },
  options: { resamples?: number; confidence?: number; seed?: number } = {},
): Comparison {
  const resamples = options.resamples ?? 10_000;
  const confidence = options.confidence ?? 0.95;
  const ci = bootstrapMeanCi(perTaskDeltas, { ...options, resamples, confidence });
  const verdict = verdictFor(ci.low, ci.high, perTaskDeltas.length);
  return {
    verdict,
    meanDelta: ci.mean,
    ciLow: ci.low,
    ciHigh: ci.high,
    confidence,
    resamples,
    tasksCompared: perTaskDeltas.length,
    sentence: describe(verdict, ci, confidence, labels, perTaskDeltas.length),
  };
}

function describe(verdict: Verdict, ci: BootstrapResult, confidence: number, labels: { a: string; b: string }, n: number): string {
  if (verdict === 'insufficient_data') return `Not enough paired tasks to compare (${n}); need at least 2.`;
  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const interval = `${Math.round(confidence * 100)}% CI ${fmt(ci.low)} to ${fmt(ci.high)}, ${n} tasks`;
  const direction = ci.mean >= 0 ? 'higher' : 'lower';
  const effect = `${labels.b} scores ${Math.abs(ci.mean).toFixed(2)} ${direction} than ${labels.a} on average (${interval})`;
  switch (verdict) {
    case 'better':
      return `${effect}. The interval is entirely above 0: ${labels.b} is better on this task set.`;
    case 'worse':
      return `${effect}. The interval is entirely below 0: ${labels.b} is worse on this task set.`;
    default:
      return `${effect}. The interval includes 0, so this is inconclusive: the data can't distinguish the two configs.`;
  }
}
