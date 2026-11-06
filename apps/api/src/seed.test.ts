/**
 * Guards the sample task set: every seed file validates, every task has a reference solution that
 * scores 1.0, and a plausible "no skill" answer (right value, plain prose) earns only partial credit.
 * If a grader is wrong, this fails before any money is spent on a live run.
 */
import { ConfigSpec, SkillSpec, TaskSpec } from '@evals/shared';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeTrial } from './grading/grading';

const SEED = join(__dirname, '..', 'seed');

async function load(kind: string): Promise<Record<string, { name: string; spec: unknown }>> {
  const dir = join(SEED, kind);
  const out: Record<string, { name: string; spec: unknown }> = {};
  for (const f of await readdir(dir)) {
    const body = JSON.parse(await readFile(join(dir, f), 'utf8'));
    expect(`${body.key}.json`).toBe(f);
    out[body.key] = body;
  }
  return out;
}

const report = (answer: string, evidence: string, confidence = 'HIGH') =>
  `ACME-REPORT v2\nANSWER: ${answer}\nEVIDENCE: ${evidence}\nCONFIDENCE: ${confidence}\nEND-REPORT`;

/** Reference solutions: [final answer, files the agent should leave behind]. */
const REFERENCE: Record<string, { answer: string; files?: Record<string, string> }> = {
  'acme-q3-emea-revenue': { answer: report('USD 1234500.00', 'finance/q3.txt:3 "EMEA revenue Q3: $1,234,500.00"') },
  'acme-contract-date': { answer: report('2026-03-07', 'contracts/globex.md:5 "This agreement was signed on March 7, 2026 by both parties."') },
  'acme-project-owner': { answer: report('RAMAN, Priya', 'team/roster.md:5 "| Helios | Priya Raman | 2024 |"') },
  'acme-largest-invoice': { answer: report('INV-1042', 'billing/invoices.csv:5 "INV-1042,Tailspin,4875.00,2026-01-21"') },
  'acme-refund-total': { answer: report('EUR 340.25', 'billing/refunds.txt:2 "R-881  Hansen GmbH      120.00"', 'MEDIUM') },
  'acme-outage-date': { answer: report('2026-02-14', 'ops/incident.log:2 "[ops] Outage began Saturday 14 Feb 2026 at 09:12 UTC"') },
  'tools-region-totals': { answer: 'Done.', files: { 'totals.json': '{"north": 1710.0, "south": 2120.75, "west": 1199.0}' } },
  'tools-fix-median': {
    answer: 'Fixed.',
    files: {
      'stats.py': 'def mean(xs):\n    return sum(xs) / len(xs)\n\n\ndef median(xs):\n    xs = sorted(xs)\n    n = len(xs)\n    mid = n // 2\n    if n % 2:\n        return xs[mid]\n    return (xs[mid - 1] + xs[mid]) / 2\n',
    },
  },
  'tools-config-lookup': { answer: '8443' },
  'control-arithmetic': { answer: '391' },
  'control-extract-city': { answer: 'Rotterdam' },
  'control-json-object': { answer: '{"name": "widget", "qty": 3}' },
};

/** What a capable agent without the ACME skill plausibly answers: the right value, no house format. */
const PLAIN: Record<string, string> = {
  'acme-q3-emea-revenue': 'EMEA revenue in Q3 2026 was $1,234,500.00 (finance/q3.txt).',
  'acme-contract-date': 'The Globex agreement was signed on March 7, 2026.',
  'acme-project-owner': 'Project Helios is owned by Priya Raman.',
  'acme-largest-invoice': 'The largest invoice is INV-1042 (Tailspin, $4,875.00).',
  'acme-refund-total': 'Total refunds in January 2026: €340.25.',
  'acme-outage-date': 'The outage began on 14 Feb 2026 at 09:12 UTC.',
};

async function grade(spec: TaskSpec, answer: string, files: Record<string, string> = {}) {
  const ws = await mkdtemp(join(tmpdir(), 'seed-test-'));
  try {
    for (const f of [...spec.files, ...Object.entries(files).map(([path, content]) => ({ path, content }))]) {
      await mkdir(dirname(join(ws, f.path)), { recursive: true });
      await writeFile(join(ws, f.path), f.content);
    }
    return await gradeTrial(spec, { finalText: answer, workspaceDir: ws });
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
}

describe('seed definitions', async () => {
  const skills = await load('skills');
  const configs = await load('configs');
  const tasks = await load('tasks');

  it('all validate against their schemas and reference existing skills', () => {
    for (const s of Object.values(skills)) SkillSpec.parse(s.spec);
    for (const c of Object.values(configs)) {
      const spec = ConfigSpec.parse(c.spec);
      for (const skill of spec.skills) expect(skills).toHaveProperty(skill);
    }
    expect(Object.keys(tasks)).toHaveLength(12);
  });

  it('has a reference solution for every task', () => {
    expect(Object.keys(REFERENCE).sort()).toEqual(Object.keys(tasks).sort());
  });

  for (const [key, ref] of Object.entries(REFERENCE)) {
    it(`${key}: reference solution scores 1.0`, async () => {
      const spec = TaskSpec.parse(tasks[key].spec);
      const result = await grade(spec, ref.answer, ref.files);
      expect(result.checks.filter((c) => !c.passed)).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }

  for (const [key, answer] of Object.entries(PLAIN)) {
    it(`${key}: a correct answer without the ACME format gets partial credit only`, async () => {
      const spec = TaskSpec.parse(tasks[key].spec);
      const result = await grade(spec, answer);
      expect(result.checks[0].passed).toBe(true); // correct value
      expect(result.passed).toBe(false);
      expect(result.score).toBeCloseTo(0.4); // 2 of 5 weight
    });
  }

  it('control tasks fail if the answer is wrapped in an ACME block (skill over-application)', async () => {
    const spec = TaskSpec.parse(tasks['control-arithmetic'].spec);
    const result = await grade(spec, report('391', 'n/a:1 "17 × 23"'));
    expect(result.passed).toBe(false);
  });

  it('the unfixed median fails its hidden test', async () => {
    const spec = TaskSpec.parse(tasks['tools-fix-median'].spec);
    const result = await grade(spec, 'I could not fix it.');
    expect(result.passed).toBe(false);
    expect(result.checks[0].reason).toContain('expected 2');
  });
});
