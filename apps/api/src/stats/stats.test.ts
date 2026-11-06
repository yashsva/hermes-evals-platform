import { describe, expect, it } from 'vitest';
import { aggregate, TrialForStats } from './aggregate';
import { bootstrapMeanCi, compareArms, median, percentile, verdictFor } from './stats';

describe('percentile', () => {
  it('interpolates linearly like numpy', () => {
    const sorted = [1, 2, 3, 4];
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 1)).toBe(4);
    expect(percentile(sorted, 0.5)).toBe(2.5);
    expect(percentile(sorted, 0.25)).toBeCloseTo(1.75);
  });
});

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('bootstrapMeanCi', () => {
  it('collapses to a point when every delta is identical', () => {
    const ci = bootstrapMeanCi([0.25, 0.25, 0.25, 0.25]);
    expect(ci).toEqual({ mean: 0.25, low: 0.25, high: 0.25 });
  });

  it('is reproducible for a fixed seed', () => {
    const deltas = [0.5, 0, 0.25, 1, -0.25, 0.75];
    expect(bootstrapMeanCi(deltas, { seed: 7 })).toEqual(bootstrapMeanCi(deltas, { seed: 7 }));
  });

  it('brackets the sample mean and stays within the data range', () => {
    const deltas = [0.5, 0, 0.25, 1, -0.25, 0.75];
    const ci = bootstrapMeanCi(deltas);
    expect(ci.mean).toBeCloseTo(0.375);
    expect(ci.low).toBeLessThan(ci.mean);
    expect(ci.high).toBeGreaterThan(ci.mean);
    expect(ci.low).toBeGreaterThanOrEqual(-0.25);
    expect(ci.high).toBeLessThanOrEqual(1);
  });

  it('approximates the normal-theory interval for a larger sample', () => {
    // 40 deltas alternating 0 and 1: mean 0.5, sd 0.5064, standard error ≈ 0.0791 → 95% CI ≈ 0.345..0.655
    const deltas = Array.from({ length: 40 }, (_, i) => i % 2);
    const ci = bootstrapMeanCi(deltas, { resamples: 20_000 });
    expect(ci.low).toBeGreaterThan(0.32);
    expect(ci.low).toBeLessThan(0.37);
    expect(ci.high).toBeGreaterThan(0.63);
    expect(ci.high).toBeLessThan(0.68);
  });
});

describe('verdict', () => {
  it('requires the whole interval on one side of zero', () => {
    expect(verdictFor(0.05, 0.3, 10)).toBe('better');
    expect(verdictFor(-0.3, -0.01, 10)).toBe('worse');
    expect(verdictFor(-0.1, 0.2, 10)).toBe('inconclusive');
    expect(verdictFor(0, 0, 10)).toBe('inconclusive');
    expect(verdictFor(0.1, 0.2, 1)).toBe('insufficient_data');
  });

  it('reports an A/A-style comparison (mixed small deltas) as inconclusive', () => {
    const result = compareArms([0.1, -0.1, 0, 0.05, -0.05, 0], { a: 'A', b: 'B' });
    expect(result.verdict).toBe('inconclusive');
    expect(result.ciLow).toBeLessThan(0);
    expect(result.ciHigh).toBeGreaterThan(0);
    expect(result.sentence).toContain('inconclusive');
  });

  it('reports a consistent improvement as better', () => {
    const result = compareArms([0.5, 0.25, 0.75, 0.5, 0.25, 1], { a: 'A', b: 'B' });
    expect(result.verdict).toBe('better');
    expect(result.ciLow).toBeGreaterThan(0);
    expect(result.sentence).toMatch(/^B scores 0\.54 higher than A/);
  });
});

describe('aggregate', () => {
  const tasks = [
    { id: 1, key: 't1', name: 'T1', tags: [] },
    { id: 2, key: 't2', name: 'T2', tags: [] },
  ];
  const trial = (taskId: number, arm: 'A' | 'B', status: TrialForStats['status'], score: number | null): TrialForStats => ({
    taskId,
    arm,
    status,
    score,
    tokensIn: 100,
    tokensOut: 10,
    costUsd: 0.001,
    durationMs: 1000,
  });

  it('pairs per task, counts errors as zero and hides the verdict until all trials are terminal', () => {
    const running = aggregate([trial(1, 'A', 'passed', 1), trial(1, 'B', 'running', null)], tasks, { a: 'A', b: 'B' });
    expect(running.comparison).toBeNull();

    const done = aggregate(
      [
        trial(1, 'A', 'passed', 1),
        trial(1, 'A', 'error', 0),
        trial(1, 'B', 'passed', 1),
        trial(1, 'B', 'passed', 1),
        trial(2, 'A', 'failed', 0.5),
        trial(2, 'B', 'passed', 1),
      ],
      tasks,
      { a: 'A', b: 'B' },
    );
    expect(done.perTask.map((t) => t.delta)).toEqual([0.5, 0.5]);
    expect(done.arms.A).toMatchObject({ trials: 3, errors: 1, passRate: 1 / 3 });
    expect(done.arms.A.meanScore).toBeCloseTo(0.5);
    expect(done.comparison?.meanDelta).toBeCloseTo(0.5);
  });

  it('excludes skipped trials and tasks missing an arm', () => {
    const result = aggregate(
      [trial(1, 'A', 'passed', 1), trial(1, 'B', 'skipped', null), trial(2, 'A', 'passed', 1), trial(2, 'B', 'failed', 0)],
      tasks,
      { a: 'A', b: 'B' },
    );
    expect(result.perTask).toHaveLength(1);
    expect(result.comparison?.verdict).toBe('insufficient_data');
  });
});
