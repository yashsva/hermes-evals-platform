<script setup lang="ts">
import type { ExperimentSummary } from '@evals/shared';
import { api } from '../api';
import { usd, when } from '../format';
import { usePoll } from '../usePoll';

const { data: experiments, error } = usePoll<ExperimentSummary[]>(
  () => api.experiments(),
  (list) => list.some((e) => e.status === 'queued' || e.status === 'running'),
);

const done = (e: ExperimentSummary) => e.counts.passed + e.counts.failed + e.counts.error + e.counts.skipped;
const total = (e: ExperimentSummary) => Object.values(e.counts).reduce((s, n) => s + n, 0);
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Experiments</h1>
      <div class="sub">Each experiment runs the same tasks under two configs and tells you whether B is better than A, and how sure we can be.</div>
    </div>
    <RouterLink to="/experiments/new" class="btn primary">New experiment</RouterLink>
  </div>
  <div v-if="error" class="banner error">{{ error }}</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>#</th><th>Name</th><th>A</th><th>B</th><th>Status</th><th class="num">Trials</th><th class="num">Spent</th><th>Created</th></tr>
      </thead>
      <tbody>
        <tr v-for="e in experiments ?? []" :key="e.id" class="clickable" @click="$router.push(`/experiments/${e.id}`)">
          <td class="sub">{{ e.id }}</td>
          <td>{{ e.name }}</td>
          <td>{{ e.configA.name }} <span class="sub">v{{ e.configA.version }}</span></td>
          <td>{{ e.configB.name }} <span class="sub">v{{ e.configB.version }}</span></td>
          <td><span class="badge" :class="e.status">{{ e.status.replace('_', ' ') }}</span></td>
          <td class="num">{{ done(e) }} / {{ total(e) }}</td>
          <td class="num">{{ usd(e.spentUsd, 3) }} <span class="sub">/ {{ usd(e.spendCapUsd, 2) }}</span></td>
          <td class="sub">{{ when(e.createdAt) }}</td>
        </tr>
        <tr v-if="experiments && experiments.length === 0">
          <td colspan="8" class="empty">No experiments yet. <RouterLink to="/experiments/new">Start one</RouterLink>.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
