<script setup lang="ts">
import type { Definition, DefinitionKind } from '@evals/shared';
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { when } from '../format';
import { kindMeta } from '../kinds';

const props = defineProps<{ kind: string }>();
const meta = computed(() => kindMeta(props.kind));
const items = ref<Definition[]>([]);
const showArchived = ref(false);
const search = ref('');
const error = ref<string | null>(null);

async function load(): Promise<void> {
  if (!meta.value) return;
  try {
    items.value = await api.definitions(props.kind as DefinitionKind, showArchived.value);
    error.value = null;
  } catch (err) {
    error.value = (err as Error).message;
  }
}
watch(() => [props.kind, showArchived.value], load, { immediate: true });

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? items.value.filter((d) => `${d.key} ${d.name} ${meta.value?.summary(d)}`.toLowerCase().includes(q)) : items.value;
});
</script>

<template>
  <div v-if="!meta" class="banner error">Unknown definition kind "{{ kind }}".</div>
  <div v-else>
    <div class="page-head">
      <div>
        <h1>{{ meta.plural }}</h1>
        <div class="sub">{{ meta.description }} Edits create a new version; experiments keep the exact version they ran.</div>
      </div>
      <RouterLink :to="`/defs/${kind}/new`" class="btn primary">New {{ meta.label.toLowerCase() }}</RouterLink>
    </div>
    <div class="row" style="margin-bottom: 10px">
      <input type="text" v-model="search" :placeholder="`Search ${meta.plural.toLowerCase()}…`" style="max-width: 320px" />
      <label class="inline"><input type="checkbox" v-model="showArchived" /> Show archived</label>
    </div>
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Key</th><th>Summary</th><th class="num">Version</th><th>Updated</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in filtered" :key="d.id" class="clickable" @click="$router.push(`/defs/${kind}/${d.key}`)">
            <td>{{ d.name }} <span v-if="d.archived" class="badge skipped">archived</span></td>
            <td class="mono">{{ d.key }}</td>
            <td class="sub">{{ meta.summary(d) }}</td>
            <td class="num">v{{ d.version }}</td>
            <td class="sub">{{ when(d.createdAt) }}</td>
          </tr>
          <tr v-if="filtered.length === 0"><td colspan="5" class="empty">Nothing here yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
