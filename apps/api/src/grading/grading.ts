import { Check, CheckResult, CheckTarget, TaskSpec } from '@evals/shared';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export interface GradeInput {
  finalText: string;
  workspaceDir: string;
}

export interface GradeResult {
  score: number;
  passed: boolean;
  checks: CheckResult[];
}

/** Runs a hidden script check. Injected so unit tests can grade without spawning processes. */
export type ScriptRunner = (check: Extract<Check, { type: 'script' }>, workspaceDir: string) => Promise<{ passed: boolean; output: string }>;

const PREVIEW = 160;

export async function gradeTrial(task: TaskSpec, input: GradeInput, runScript: ScriptRunner = runScriptCheck): Promise<GradeResult> {
  const checks: CheckResult[] = [];
  for (const check of task.checks) {
    const outcome = await gradeCheck(check, input, runScript).catch((err: Error) => ({
      passed: false,
      reason: `Check crashed: ${err.message}`,
    }));
    checks.push({ name: check.name, type: check.type, weight: check.weight, required: check.required, ...outcome });
  }
  return { ...scoreChecks(checks, task.passThreshold), checks };
}

/** Weighted fraction of passed checks; a trial passes when it meets the threshold and every required check passed. */
export function scoreChecks(checks: CheckResult[], passThreshold: number): { score: number; passed: boolean } {
  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const score = total === 0 ? 0 : earned / total;
  const requiredOk = checks.every((c) => !c.required || c.passed);
  // Small epsilon so 0.75 computed as 0.7499999 still meets a 0.75 threshold.
  return { score, passed: requiredOk && score + 1e-9 >= passThreshold };
}

async function gradeCheck(check: Check, input: GradeInput, runScript: ScriptRunner): Promise<{ passed: boolean; reason: string }> {
  if (check.type === 'script') {
    const { passed, output } = await runScript(check, input.workspaceDir);
    // The last line is the one that explains (e.g. Python's "AssertionError: …"); lead with it, keep a little context below.
    const lines = output.trim().split('\n').filter((line) => line.trim());
    const last = lines.at(-1) ?? '';
    if (passed) return { passed, reason: `Hidden test passed${last ? `: ${last}` : ''}` };
    const context = lines.slice(-6, -1).join('\n');
    return { passed, reason: last ? `Hidden test failed: ${last}${context ? `\n\n${context}` : ''}` : 'Hidden test failed: (no output)' };
  }

  const text = await readTarget(check.target, input);
  if (text === null) {
    return { passed: false, reason: `File ${describeTarget(check.target)} was not created` };
  }

  switch (check.type) {
    case 'contains': {
      const haystack = check.caseSensitive ? text : text.toLowerCase();
      const needle = check.caseSensitive ? check.value : check.value.toLowerCase();
      const passed = haystack.includes(needle);
      return {
        passed,
        reason: passed
          ? `Found "${check.value}" in ${describeTarget(check.target)}`
          : `"${check.value}" not found in ${describeTarget(check.target)} (starts: "${preview(text)}")`,
      };
    }
    case 'regex': {
      const match = new RegExp(check.pattern, check.flags).exec(text);
      return {
        passed: match !== null,
        reason: match
          ? `/${check.pattern}/ matched "${preview(match[0])}" in ${describeTarget(check.target)}`
          : `/${check.pattern}/ did not match ${describeTarget(check.target)} (starts: "${preview(text)}")`,
      };
    }
    case 'json': {
      const parsed = extractJson(text);
      if (parsed === undefined) {
        return { passed: false, reason: `No parseable JSON object in ${describeTarget(check.target)} (starts: "${preview(text)}")` };
      }
      const actual = getPath(parsed, check.field);
      const passed = looselyEqual(actual, check.equals);
      return {
        passed,
        reason: passed
          ? `${check.field} = ${JSON.stringify(actual)}`
          : `${check.field} is ${actual === undefined ? 'missing' : JSON.stringify(actual)}, expected ${JSON.stringify(check.equals)}`,
      };
    }
  }
}

async function readTarget(target: CheckTarget, input: GradeInput): Promise<string | null> {
  if (target.kind === 'answer') return input.finalText;
  const root = resolve(input.workspaceDir);
  const file = resolve(root, target.path);
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function describeTarget(target: CheckTarget): string {
  return target.kind === 'answer' ? 'the final answer' : target.path;
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW)}…` : flat;
}

/** Accepts a fenced ```json block, a whole-text JSON document, or the first balanced {...} object. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text, firstBalancedObject(text)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function firstBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

export function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

/** Numbers compare numerically ("42" equals 42); strings compare trimmed and case-insensitively. */
function looselyEqual(actual: unknown, expected: string | number | boolean): boolean {
  if (actual === undefined || actual === null) return false;
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') return actual === expected || String(actual).toLowerCase() === String(expected);
  return String(actual).trim().toLowerCase() === expected.trim().toLowerCase();
}

/**
 * Writes the script to a temp dir outside the workspace (so the agent never saw it) and runs it
 * with the workspace as cwd. 60s limit.
 */
export async function runScriptCheck(
  check: Extract<Check, { type: 'script' }>,
  workspaceDir: string,
): Promise<{ passed: boolean; output: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'grader-'));
  const file = join(dir, check.language === 'python' ? 'check.py' : 'check.sh');
  await writeFile(file, check.code, 'utf8');
  const [cmd, args] = check.language === 'python' ? ['python3', [file]] : ['bash', [file]];
  try {
    return await new Promise((done) => {
      execFile(cmd, args, { cwd: workspaceDir, timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        done({ passed: !err, output: `${stdout}${stderr}`.slice(-4000) });
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
