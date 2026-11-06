<script setup lang="ts">
import type { TrialDetail, TrialEvent } from '@evals/shared';
import { computed } from 'vue';
import { api } from '../api';
import { score, seconds, tokens, usd } from '../format';
import { usePoll } from '../usePoll';

const props = defineProps<{ id: number }>();
const { data: trial, error } = usePoll<TrialDetail>(
  () => api.trial(props.id),
  (t) => t.status === 'queued' || t.status === 'running',
);

const PREVIEW = 1200;
const show = (v: unknown) => {
  const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return text && text.length > PREVIEW ? `${text.slice(0, PREVIEW)}\n… (${text.length - PREVIEW} more chars)` : text;
};

const toolCalls = computed(() => trial.value?.events.filter((e) => e.type === 'tool_use').length ?? 0);
const isError = (e: TrialEvent) => Boolean(e.payload.is_error) || (e.type === 'result' && (e.payload.exit_code !== 0 || e.payload.error));

/** Plain-language summary of why the trial ended where it did. */
const explanation = computed(() => {
  const t = trial.value;
  if (!t) return '';
  if (t.status === 'error') return `The run did not produce a usable answer: ${t.error ?? 'unknown error'}. It counts as score 0.`;
  const failed = t.checks.filter((c) => !c.passed);
  const requiredFailed = failed.filter((c) => c.required);
  const threshold = t.task.spec.passThreshold;
  if (t.status === 'passed') return `Passed: score ${score(t.score)} meets the ${threshold} threshold${failed.length ? ` (${failed.length} non-required check(s) failed)` : ''}.`;
  if (requiredFailed.length) return `Failed: required check(s) ${requiredFailed.map((c) => `"${c.name}"`).join(', ')} did not pass.`;
  return `Failed: score ${score(t.score)} is below the ${threshold} threshold. ${failed.length} of ${t.checks.length} checks failed.`;
});
</script>

<template>
  <div v-if="error && !trial" class="banner error">{{ error }}</div>
  <div v-if="trial">
    <div class="page-head">
      <div>
        <div class="sub">
          <RouterLink :to="`/experiments/${trial.experimentId}`">Experiment #{{ trial.experimentId }}</RouterLink> / trial #{{ trial.id }}
        </div>
        <h1>
          {{ trial.task.name }} <span class="sub">· arm {{ trial.arm }} ({{ trial.config.name }}) · repeat {{ trial.repeat }}</span>
          <span class="badge" :class="trial.status" style="margin-left: 6px">{{ trial.status }}</span>
        </h1>
      </div>
    </div>

    <div class="card">
      <div class="verdict" style="margin-bottom: 10px">{{ explanation }}</div>
      <div class="stats">
        <div class="stat"><span class="v">{{ score(trial.score) }}</span><span class="k">score</span></div>
        <div class="stat"><span class="v">{{ toolCalls }}</span><span class="k">tool calls</span></div>
        <div class="stat"><span class="v">{{ tokens(trial.tokensIn) }} / {{ tokens(trial.tokensOut) }}</span><span class="k">tokens in / out</span></div>
        <div class="stat"><span class="v">{{ usd(trial.costUsd) }}</span><span class="k">cost</span></div>
        <div class="stat"><span class="v">{{ seconds(trial.durationMs) }}</span><span class="k">duration</span></div>
        <div class="stat"><span class="v">{{ trial.exitCode ?? '—' }}</span><span class="k">exit code</span></div>
        <div class="stat" v-if="trial.attempts > 1"><span class="v">{{ trial.attempts }}</span><span class="k">attempts</span></div>
      </div>
      <div v-if="trial.error" class="banner error" style="margin-top: 10px">{{ trial.error }}</div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2 style="margin-top: 0">Checks</h2>
        <div v-for="c in trial.checks" :key="c.name" class="check" :class="c.passed ? 'ok' : 'no'">
          <span class="icon">{{ c.passed ? '✓' : '✗' }}</span>
          <div style="flex: 1; min-width: 0">
            <div>
              <strong>{{ c.name }}</strong>
              <span class="sub"> · {{ c.type }} · weight {{ c.weight }}</span>
              <span v-if="c.required" class="badge" style="margin-left: 4px">required</span>
            </div>
            <div class="sub" style="word-break: break-word">{{ c.reason }}</div>
          </div>
        </div>
        <div v-if="trial.checks.length === 0" class="sub">No checks ran{{ trial.status === 'error' ? ' — the run errored before grading' : '' }}.</div>

        <h3>Final answer</h3>
        <pre>{{ trial.finalText || '(empty)' }}</pre>
      </div>

      <div class="card">
        <h2 style="margin-top: 0">Task</h2>
        <pre>{{ trial.task.spec.prompt }}</pre>
        <div class="sub" v-if="trial.task.spec.files.length">Workspace files: <span class="mono">{{ trial.task.spec.files.map((f) => f.path).join(', ') }}</span></div>
        <h3>Config</h3>
        <div class="mono sub">
          {{ trial.config.spec.model }} · tools: {{ trial.config.spec.toolsets.join(', ') }} · skills: {{ trial.config.spec.skills.join(', ') || 'none' }} ·
          memory: {{ trial.config.spec.memory.enabled ? 'on' : 'off' }} · max turns {{ trial.config.spec.maxTurns }}
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top: 0">Trajectory <span class="sub">({{ trial.events.length }} events)</span></h2>
      <ul class="timeline">
        <li v-for="e in trial.events" :key="e.seq" :class="[e.type, { err: isError(e) }]">
          <template v-if="e.type === 'tool_use'">
            <div class="head">#{{ e.seq }} tool call</div>
            <strong class="mono">{{ e.payload.name }}</strong>
            <pre>{{ show(e.payload.input) }}</pre>
          </template>
          <template v-else-if="e.type === 'tool_result'">
            <div class="head">
              #{{ e.seq }} result of <span class="mono">{{ e.payload.name }}</span> · {{ e.payload.duration_ms ?? '?' }}ms
              <span v-if="e.payload.is_error" class="badge error">error</span>
            </div>
            <pre>{{ show(e.payload.output) }}</pre>
          </template>
          <template v-else-if="e.type === 'text'">
            <div class="head">#{{ e.seq }} assistant</div>
            <pre>{{ show(e.payload.text) }}</pre>
          </template>
          <template v-else-if="e.type === 'result'">
            <div class="head">#{{ e.seq }} finished · exit {{ e.payload.exit_code }} · {{ seconds(e.payload.duration_ms as number) }}</div>
            <div v-if="e.payload.error" class="field-error">{{ e.payload.error }}</div>
          </template>
          <template v-else>
            <div class="head">#{{ e.seq }} {{ e.type }}</div>
            <pre>{{ show(e.payload) }}</pre>
          </template>
        </li>
      </ul>
      <div v-if="trial.events.length === 0" class="sub">No events recorded.</div>
      <details v-if="trial.stderrTail" style="margin-top: 10px">
        <summary class="sub">Hermes stderr (last lines)</summary>
        <pre>{{ trial.stderrTail }}</pre>
      </details>
    </div>
  </div>
</template>
