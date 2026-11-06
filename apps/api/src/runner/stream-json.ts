/**
 * Parser for `hermes chat --format stream-json` output: one JSON object per stdout line, with types
 * `system`, `text` (streamed deltas), `tool_use`, `tool_result` and a terminal `result`.
 */

export interface ParsedEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface ParsedStream {
  events: ParsedEvent[];
  result: {
    text: string;
    exitCode: number | null;
    tokens: { input: number; output: number; cacheRead: number };
    durationMs: number | null;
    error: string | null;
  } | null;
}

const MAX_PAYLOAD_CHARS = 20_000;

export function parseStreamJson(stdout: string): ParsedStream {
  const events: ParsedEvent[] = [];
  let result: ParsedStream['result'] = null;
  let pendingText = '';

  // Consecutive `text` deltas are merged into one event so the trajectory reads as messages, not tokens.
  const flushText = () => {
    if (pendingText) events.push({ type: 'text', payload: { text: pendingText } });
    pendingText = '';
  };

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      flushText();
      events.push({ type: 'unparsed', payload: { line: truncate(trimmed) } });
      continue;
    }
    const type = typeof obj.type === 'string' ? obj.type : 'unknown';
    if (type === 'text') {
      pendingText += String(obj.text ?? obj.delta ?? '');
      continue;
    }
    flushText();
    if (type === 'result') {
      const tokens = (obj.tokens ?? {}) as Record<string, unknown>;
      result = {
        text: String(obj.text ?? ''),
        exitCode: typeof obj.exit_code === 'number' ? obj.exit_code : null,
        tokens: {
          input: num(tokens.input),
          output: num(tokens.output),
          cacheRead: num(tokens.cache_read),
        },
        durationMs: typeof obj.duration_ms === 'number' ? obj.duration_ms : null,
        error: obj.error ? String(obj.error) : null,
      };
    }
    const { type: _type, ...rest } = obj;
    events.push({ type, payload: limitPayload(rest) });
  }
  flushText();
  return { events, result };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function truncate(text: string): string {
  return text.length > MAX_PAYLOAD_CHARS ? `${text.slice(0, MAX_PAYLOAD_CHARS)}… [truncated]` : text;
}

function limitPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = typeof value === 'string' ? truncate(value) : value;
  }
  return out;
}

/**
 * Heuristic for failures worth retrying: the provider or Hermes' own gateway, not the agent, was at fault.
 * Each trial has a fresh home, so a retry is a clean rerun.
 */
export function isProviderError(message: string): boolean {
  return /\b(429|rate.?limit|too many requests|50[0-4]|overloaded|timed? ?out contacting|connection (reset|refused|error)|upstream|gateway disconnected)\b/i.test(
    message,
  );
}
