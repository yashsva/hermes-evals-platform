<script setup lang="ts">
import type { ConfigSpec, CostEstimate, Definition, TaskSpec } from '@evals/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '../api';
import ConfigDiff from '../components/ConfigDiff.vue';
import { usd } from '../format';

const router = useRouter();
const configs = ref<Definition<'config'>[]>([]);
const tasks = ref<Definition<'task'>[]>([]);
const name = ref('');
const configAId = ref<number | null>(null);
const configBId = ref<number | null>(null);
const selected = ref<Set<number>>(new Set());
const repeats = ref(3);
const spendCapUsd = ref(2);
const estimate = ref<CostEstimate | null>(null);
const estimateError = ref<string | null>(null);
const error = ref<string | null>(null);
const starting = ref(false);

onMounted(async () => {
  [configs.value, tasks.value] = await Promise.all([api.definitions('config'), api.definitions('task')]);
  configAId.value = configs.value[0]?.id ?? null;
  configBId.value = configs.value[1]?.id ?? configs.value[0]?.id ?? null;
  selected.value = new Set(tasks.value.map((t) => t.id));
});

const configA = computed(() => configs.value.find((c) => c.id === configAId.value));
const configB = computed(() => configs.value.find((c) => c.id === configBId.value));
const allTags = computed(() => [...new Set(tasks.value.flatMap((t) => (t.spec as TaskSpec).tags))].sort());

// Suggest a name from the configs until the user types their own.
const nameTouched = ref(false);
watch([configA, configB], () => {
  if (configA.value && configB.value && !nameTouched.value) {
    name.value = configA.value.id === configB.value.id ? `A/A: ${configA.value.name}` : `${configA.value.name} vs ${configB.value.name}`;
  }
});

function toggleTask(id: number): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function selectTag(tag: string | null): void {
  selected.value = new Set(tasks.value.filter((t) => tag === null || (t.spec as TaskSpec).tags.includes(tag)).map((t) => t.id));
}

const input = computed(() => ({
  name: name.value,
  configAId: configAId.value ?? undefined,
  configBId: configBId.value ?? undefined,
  taskIds: [...selected.value],
  repeats: repeats.value,
  spendCapUsd: spendCapUsd.value,
}));

let debounce: ReturnType<typeof setTimeout> | undefined;
watch(
  input,
  (value) => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      if (!value.configAId || !value.configBId || value.taskIds.length < 2) {
        estimate.value = null;
        return;
      }
      try {
        estimate.value = await api.estimate({ ...value, name: value.name || 'estimate' });
        estimateError.value = null;
      } catch (err) {
        estimate.value = null;
        estimateError.value = err instanceof ApiError && err.issues.length ? err.issues.map((i) => `${i.path}: ${i.message}`).join('; ') : (err as Error).message;
      }
    }, 250);
  },
  { deep: true },
);

const overCap = computed(() => estimate.value?.estimatedUsd != null && estimate.value.estimatedUsd > spendCapUsd.value);

async function start(): Promise<void> {
  starting.value = true;
  error.value = null;
  try {
    const { id } = await api.createExperiment(input.value);
    await router.push(`/experiments/${id}`);
  } catch (err) {
    error.value = err instanceof ApiError && err.issues.length ? err.issues.map((i) => `${i.path}: ${i.message}`).join('; ') : (err as Error).message;
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div class="page-head">
    <div>
      <div class="sub"><RouterLink to="/experiments">Experiments</RouterLink> /</div>
      <h1>New experiment</h1>
      <div class="sub">Every selected task runs under both configs, {{ repeats }}× each, in random order.</div>
    </div>
  </div>

  <div v-if="error" class="banner error">{{ error }}</div>

  <div class="grid2">
    <div class="card">
      <label>Name</label>
      <input type="text" v-model="name" @input="nameTouched = true" />
      <div class="grid2">
        <div>
          <label>Config A (baseline)</label>
          <select v-model.number="configAId">
            <option v-for="c in configs" :key="c.id" :value="c.id">{{ c.name }} (v{{ c.version }})</option>
          </select>
        </div>
        <div>
          <label>Config B (candidate)</label>
          <select v-model.number="configBId">
            <option v-for="c in configs" :key="c.id" :value="c.id">{{ c.name }} (v{{ c.version }})</option>
          </select>
        </div>
      </div>
      <div class="grid2">
        <div>
          <label>Repeats per task and config</label>
          <input type="number" v-model.number="repeats" min="1" max="10" />
          <div class="hint">Agents are non-deterministic; repeats measure that noise.</div>
        </div>
        <div>
          <label>Spend cap (USD)</label>
          <input type="number" v-model.number="spendCapUsd" min="0.01" step="0.25" />
          <div class="hint">Refuses to start above it; stops queueing when reached.</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top: 0">What changes between A and B</h3>
      <ConfigDiff v-if="configA && configB" :a="configA.spec as ConfigSpec" :b="configB.spec as ConfigSpec" :label-a="`A: ${configA.name}`" :label-b="`B: ${configB.name}`" />
      <h3>Cost estimate</h3>
      <div v-if="estimate">
        <div class="stats">
          <div class="stat"><span class="v">{{ estimate.trials }}</span><span class="k">trials</span></div>
          <div class="stat"><span class="v">{{ usd(estimate.estimatedUsd, 2) }}</span><span class="k">estimated total</span></div>
          <div class="stat"><span class="v">{{ usd(estimate.perTrialUsd, 4) }}</span><span class="k">per trial</span></div>
        </div>
        <div class="hint">
          Based on {{ estimate.basis === 'history' ? 'average tokens of past trials with this model' : 'a default of 15k input / 1.5k output tokens per trial' }}
          and OpenRouter list prices. Upper bound (ignores cache discounts).
        </div>
        <div v-if="estimate.missingPrices.length" class="banner warn" style="margin-top: 8px">No price found for {{ estimate.missingPrices.join(', ') }}.</div>
        <div v-if="overCap" class="banner error" style="margin-top: 8px">Estimate exceeds the spend cap.</div>
      </div>
      <div v-else-if="estimateError" class="banner error">{{ estimateError }}</div>
      <div v-else class="sub">Pick two configs and at least two tasks.</div>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <h3 style="margin: 0">Tasks ({{ selected.size }} / {{ tasks.length }})</h3>
      <span class="spacer" />
      <button @click="selectTag(null)">All</button>
      <button @click="selected = new Set()">None</button>
      <button v-for="tag in allTags" :key="tag" @click="selectTag(tag)">Only {{ tag }}</button>
    </div>
    <table style="margin-top: 8px">
      <tbody>
        <tr v-for="t in tasks" :key="t.id" class="clickable" @click="toggleTask(t.id)">
          <td style="width: 28px"><input type="checkbox" :checked="selected.has(t.id)" @click.stop="toggleTask(t.id)" /></td>
          <td>{{ t.name }} <span class="sub mono">{{ t.key }} v{{ t.version }}</span></td>
          <td><span v-for="tag in (t.spec as TaskSpec).tags" :key="tag" class="badge" style="margin-right: 4px">{{ tag }}</span></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="row">
    <span class="spacer" />
    <button class="primary" :disabled="starting || !estimate || overCap" @click="start">Start experiment</button>
  </div>
</template>
