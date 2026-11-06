import { z } from 'zod';

/**
 * Where a check looks. `answer` is the agent's final reply; `file` is a file the agent
 * left in its workspace (path relative to the workspace root).
 */
const Target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer') }),
  z.object({ kind: z.literal('file'), path: z.string().min(1, 'Required') }),
]);
export type CheckTarget = z.infer<typeof Target>;

const CheckBase = {
  name: z.string().min(1, 'Required').max(120),
  weight: z.number().positive().default(1),
  /** A required check must pass for the trial to pass, regardless of score. */
  required: z.boolean().default(false),
};

export const ContainsCheck = z.object({
  ...CheckBase,
  type: z.literal('contains'),
  target: Target,
  value: z.string().min(1, 'Required'),
  caseSensitive: z.boolean().default(false),
});

export const RegexCheck = z.object({
  ...CheckBase,
  type: z.literal('regex'),
  target: Target,
  pattern: z.string().min(1, 'Required').refine(isValidRegex, 'Invalid regular expression'),
  flags: z.string().regex(/^[imsu]*$/, 'Allowed flags: i, m, s, u').default(''),
});

/** Parses JSON from the target (a fenced ```json block or the first {...} object) and compares one field. */
export const JsonCheck = z.object({
  ...CheckBase,
  type: z.literal('json'),
  target: Target,
  /** Dot path, e.g. `totals.north` or `items.0.id`. */
  field: z.string().min(1, 'Required'),
  equals: z.union([z.string(), z.number(), z.boolean()]),
});

/**
 * A hidden test. The script is written outside the agent's workspace only after the agent has
 * finished, then run with the workspace as its working directory. Exit code 0 = pass.
 */
export const ScriptCheck = z.object({
  ...CheckBase,
  type: z.literal('script'),
  language: z.enum(['python', 'bash']),
  code: z.string().min(1, 'Required').max(20_000),
});

export const Check = z.discriminatedUnion('type', [ContainsCheck, RegexCheck, JsonCheck, ScriptCheck]);
export type Check = z.infer<typeof Check>;
export type CheckType = Check['type'];

export const FixtureFile = z.object({
  path: z
    .string()
    .min(1, 'Required')
    .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'Must be a relative path inside the workspace'),
  content: z.string().max(100_000),
});
export type FixtureFile = z.infer<typeof FixtureFile>;

export const TaskSpec = z.object({
  prompt: z.string().min(1, 'Required').max(20_000),
  tags: z.array(z.string().min(1)).default([]),
  /** Files copied into the agent's workspace before the run. */
  files: z.array(FixtureFile).max(50).default([]),
  checks: z.array(Check).min(1, 'Add at least one check'),
  /** Weighted score needed to pass (0–1). */
  passThreshold: z.number().min(0).max(1).default(1),
  timeoutSec: z.number().int().min(10).max(1800).default(180),
});
export type TaskSpec = z.infer<typeof TaskSpec>;

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
