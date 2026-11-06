import type {
  CostEstimate,
  CreateExperimentInput,
  Definition,
  DefinitionKind,
  ExperimentDetail,
  ExperimentSummary,
  TrialDetail,
} from '@evals/shared';

export interface Issue {
  path: string;
  message: string;
}

/** Error carrying the API's field-level validation issues so forms can show them inline. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: Issue[] = [],
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(data.message) ? data.message.join('; ') : data.message ?? res.statusText;
    throw new ApiError(message, res.status, data.issues ?? []);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean; runner: string; agentVersion: string; providerKeyConfigured: boolean }>('GET', '/api/health'),

  definitions: <K extends DefinitionKind>(kind: K, archived = false) =>
    request<Definition<K>[]>('GET', `/api/definitions/${kind}?archived=${archived}`),
  definition: <K extends DefinitionKind>(kind: K, key: string) =>
    request<{ latest: Definition<K>; versions: Definition<K>[] }>('GET', `/api/definitions/${kind}/${encodeURIComponent(key)}`),
  definitionById: (id: number) => request<Definition>('GET', `/api/definitions/by-id/${id}`),
  createDefinition: (kind: DefinitionKind, body: { key: string; name: string; spec: unknown }) =>
    request<Definition>('POST', `/api/definitions/${kind}`, body),
  updateDefinition: (kind: DefinitionKind, key: string, body: { name: string; spec: unknown }) =>
    request<Definition>('PUT', `/api/definitions/${kind}/${encodeURIComponent(key)}`, body),
  archiveDefinition: (kind: DefinitionKind, key: string, archived: boolean) =>
    request<void>('POST', `/api/definitions/${kind}/${encodeURIComponent(key)}/archive`, { archived }),

  experiments: () => request<ExperimentSummary[]>('GET', '/api/experiments'),
  experiment: (id: number) => request<ExperimentDetail>('GET', `/api/experiments/${id}`),
  estimate: (input: Partial<CreateExperimentInput>) => request<CostEstimate>('POST', '/api/experiments/estimate', input),
  createExperiment: (input: Partial<CreateExperimentInput>) => request<{ id: number }>('POST', '/api/experiments', input),
  cancelExperiment: (id: number) => request<void>('POST', `/api/experiments/${id}/cancel`),
  trial: (id: number) => request<TrialDetail>('GET', `/api/trials/${id}`),
};
