<script setup lang="ts">
import type { Arm, ConfigSpec, ExperimentDetail, TrialRow } from '@evals/shared';
import { computed } from 'vue';
import { api } from '../api';
import ConfigDiff from '../components/ConfigDiff.vue';
import { pct, score, seconds, signed, tokens, usd, when } from '../format';
import { usePoll } from '../usePoll';

const props = defineProps<{ id: number }>();
const { data: exp, error, refresh } = usePoll<ExperimentDetail>(
  () => api.experiment(props.id),
  (e) => e.status === 'queued' || e.status === 'running',
);

const total = computed(() => (exp.value ? Object.values(exp.value.counts).reduce((s, n) => s + n, 0) : 0));
const finished = computed(() => (exp.value ? total.value - exp.value.counts.queued - exp.value.counts.running : 0));
const active = computed(() => exp.value?.status === 'queued' || exp.value?.status === 'running');

const trialsByCell = computed(() => {
  const map = new Map<string, TrialRow[]>();
  for (const t of exp.value?.trials ?? []) {
    const key = `${t.taskId}:${t.arm}`;
    map.set(key, [...(map.get(key) ?? []), t]);
  }
  return map;
});
const cell = (taskId: number, arm: Arm) => trialsByCell.value.get(`${taskId}:${arm}`) ?? [];

/** Position on a -1..+1 axis (score deltas are bounded) as a CSS percentage. */
const pos = (v: number) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;

async function cancel(): Promise<void> {
  if (!confirm('Cancel this experiment? Queued trials will be skipped; running ones finish.')) return;
  await api.cancelExperiment(props.id);
  await refresh();
}

const chipClass = (t: TrialRow) => (t.status === 'passed' ? 'passed' : t.status === 'failed' ? 'failed' : t.status);
</script>

<template>
  <div v-if="error && !exp" class="banner error">{{ error }}</div>
  <div v-if="exp">
    <div class="page-head">
      <div>
        <div class="sub"><RouterLink to="/experiments">Experiments</RouterLink> / #{{ exp.id }}</div>
        <h1>{{ exp.name }} <span class="badge" :class="exp.status">{{ exp.status.replace('_', ' ') }}</span></h1>
        <div class="sub">
          A: {{ exp.configA.name }} v{{ exp.configA.version }} · B: {{ exp.configB.name }} v{{ exp.configB.version }} ·
          {{ exp.tasks.length }} tasks × {{ exp.repeats }} repeats · {{ exp.hermesVersion }} · started {{ when(exp.createdAt) }}
        </div>
      </div>
      <button v-if="active" class="danger" @click="cancel">Cancel</button>
    </div>

    <div class="card">
      <div class="stats">
        <div class="stat"><span class="v">{{ finished }} / {{ total }}</span><span class="k">trials finished</span></div>
        <div class="stat"><span class="v">{{ exp.counts.running }}</span><span class="k">running</span></div>
        <div class="stat"><span class="v">{{ exp.counts.error }}</span><span class="k">errors (scored 0)</span></div>
        <div class="stat" v-if="exp.counts.skipped"><span class="v">{{ exp.counts.skipped }}</span><span class="k">skipped</span></div>
        <div class="stat"><span class="v">{{ usd(exp.spentUsd, 3) }}</span><span class="k">spent of {{ usd(exp.spendCapUsd, 2) }} cap</span></div>
      </div>
      <div v-if="exp.status === 'budget_stopped'" class="banner warn" style="margin-top: 10px">Stopped at the spend cap. Results use only the trials that ran.</div>
    </div>

    <div class="card">
      <h2 style="margin-top: 0">Verdict</h2>
      <template v-if="exp.comparison">
        <div class="verdict">
          <span class="badge" :class="exp.comparison.verdict" style="font-size: 14px; margin-right: 6px">{{ exp.comparison.verdict.replace('_', ' ') }}</span>
          {{ exp.comparison.sentence }}
        </div>
        <template v-if="exp.comparison.tasksCompared >= 2">
          <div class="ci-bar" :title="`${Math.round(exp.comparison.confidence * 100)}% CI ${signed(exp.comparison.ciLow)} to ${signed(exp.comparison.ciHigh)}`">
            <div class="axis" />
            <div class="zero" :style="{ left: pos(0) }" />
            <div class="range" :style="{ left: pos(exp.comparison.ciLow), width: `calc(${pos(exp.comparison.ciHigh)} - ${pos(exp.comparison.ciLow)})` }" />
            <div class="point" :style="{ left: pos(exp.comparison.meanDelta) }" />
          </div>
          <div class="ci-labels"><span>−1 (B much worse)</span><span>0</span><span>+1 (B much better)</span></div>
          <p class="hint">
            Mean per-task score difference (B − A) with a {{ Math.round(exp.comparison.confidence * 100) }}% paired bootstrap interval
            ({{ exp.comparison.resamples.toLocaleString() }} resamples of the {{ exp.comparison.tasksCompared }} tasks). Each task's score is
            averaged over its repeats first, so the interval reflects variation across tasks, not just run-to-run noise. Errors and
            timeouts count as 0.
          </p>
        </template>
      </template>
      <div v-else class="sub">The verdict appears once every trial has finished ({{ finished }} / {{ total }}), so a half-finished run never shows a winner.</div>
    </div>

    <div class="card">
      <h2 style="margin-top: 0">By config</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Arm</th><th class="num">Trials</th><th class="num">Mean score</th><th class="num">Pass rate</th><th class="num">Errors</th><th class="num">Tokens in / out</th><th class="num">Cost</th><th class="num">Median time</th></tr>
          </thead>
          <tbody>
            <tr v-for="arm in (['A', 'B'] as const)" :key="arm">
              <td><strong>{{ arm }}</strong> {{ arm === 'A' ? exp.configA.name : exp.configB.name }}</td>
              <td class="num">{{ exp.arms[arm].trials }}</td>
              <td class="num">{{ score(exp.arms[arm].meanScore) }}</td>
              <td class="num">{{ pct(exp.arms[arm].passRate) }}</td>
              <td class="num">{{ exp.arms[arm].errors }}</td>
              <td class="num">{{ tokens(exp.arms[arm].tokensIn) }} / {{ tokens(exp.arms[arm].tokensOut) }}</td>
              <td class="num">{{ usd(exp.arms[arm].costUsd, 3) }}</td>
              <td class="num">{{ seconds(exp.arms[arm].medianDurationMs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top: 0">By task</h2>
      <div class="hint" style="margin-bottom: 8px">Each chip is one trial (its score); click it to see why it passed or failed.</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Task</th><th>A trials</th><th>B trials</th><th class="num">Mean A</th><th class="num">Mean B</th><th class="num">Δ (B − A)</th></tr>
          </thead>
          <tbody>
            <tr v-for="task in exp.tasks" :key="task.id">
              <td>{{ task.name }} <div class="sub mono">{{ task.key }} v{{ task.version }}</div></td>
              <td v-for="arm in (['A', 'B'] as const)" :key="arm">
                <RouterLink v-for="t in cell(task.id, arm)" :key="t.id" :to="`/trials/${t.id}`" class="badge" :class="chipClass(t)" style="margin: 0 4px 4px 0" :title="t.error ?? t.status">
                  {{ t.score === null ? t.status : score(t.score) }}
                </RouterLink>
              </td>
              <template v-for="row in exp.perTask.filter((r) => r.taskId === task.id)" :key="row.taskId">
                <td class="num">{{ score(row.meanA) }}</td>
                <td class="num">{{ score(row.meanB) }}</td>
                <td class="num"><strong :style="{ color: row.delta > 0 ? 'var(--good)' : row.delta < 0 ? 'var(--bad)' : undefined }">{{ signed(row.delta) }}</strong></td>
              </template>
              <template v-if="!exp.perTask.some((r) => r.taskId === task.id)"><td class="num">—</td><td class="num">—</td><td class="num">—</td></template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h2 style="margin-top: 0">Configs compared</h2>
        <ConfigDiff :a="exp.configASpec.spec as ConfigSpec" :b="exp.configBSpec.spec as ConfigSpec" :label-a="`A: ${exp.configA.name}`" :label-b="`B: ${exp.configB.name}`" />
      </div>
      <div class="card">
        <h2 style="margin-top: 0">Reproducibility</h2>
        <table>
          <tbody>
            <tr><td>Agent harness</td><td class="mono">{{ exp.hermesVersion }}</td></tr>
            <tr><td>Config versions</td><td class="mono">A #{{ exp.configA.id }} · B #{{ exp.configB.id }}</td></tr>
            <tr><td>Pinned skills</td><td class="mono">{{ exp.skills.map((s) => `${s.key} v${s.version}`).join(', ') || '—' }}</td></tr>
            <tr v-for="(p, model) in exp.prices" :key="model"><td>Price {{ model }}</td><td class="mono">${{ p.inputPerM.toFixed(3) }} in / ${{ p.outputPerM.toFixed(3) }} out per 1M tokens</td></tr>
            <tr v-if="exp.estimate"><td>Pre-run estimate</td><td class="mono">{{ usd(exp.estimate.estimatedUsd, 3) }} ({{ exp.estimate.basis }})</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
