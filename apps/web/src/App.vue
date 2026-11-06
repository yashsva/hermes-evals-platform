<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from './api';
import { KINDS } from './kinds';

const health = ref<Awaited<ReturnType<typeof api.health>> | null>(null);
onMounted(async () => {
  health.value = await api.health().catch(() => null);
});
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <RouterLink to="/experiments" class="brand">Agent Evals</RouterLink>
      <nav>
        <RouterLink to="/experiments">Experiments</RouterLink>
        <RouterLink v-for="(meta, kind) in KINDS" :key="kind" :to="`/defs/${kind}`">{{ meta.plural }}</RouterLink>
      </nav>
      <span class="status" v-if="health">
        {{ health.agentVersion }}
        <span v-if="health.runner === 'fake'" class="badge budget_stopped">fake runner — not evidence</span>
        <span v-else-if="!health.providerKeyConfigured" class="badge error">OPENROUTER_API_KEY not set</span>
      </span>
    </header>
    <RouterView />
  </div>
</template>
