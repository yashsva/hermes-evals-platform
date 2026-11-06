export const usd = (v: number | null | undefined, digits = 4) => (v === null || v === undefined ? '—' : `$${v.toFixed(digits)}`);
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const score = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2));
export const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
export const seconds = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);
export const tokens = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** Turns a Zod error or API issue list into a path → message map for inline form errors. */
export function issueMap(issues: { path: string | (string | number)[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : issue.path;
    out[path] ??= issue.message;
  }
  return out;
}
