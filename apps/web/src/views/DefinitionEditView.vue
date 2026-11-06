<script setup lang="ts">
import { DefinitionKey, DEFINITION_KINDS, type Definition, type DefinitionKind } from '@evals/shared';
import { computed, ref, toRaw, watch } from 'vue';
import { useRouter, type HistoryState } from 'vue-router';
import { api, ApiError } from '../api';
import { issueMap, when } from '../format';
import { kindMeta } from '../kinds';

interface DuplicateState {
  name: string;
  spec: Record<string, unknown>;
}

const props = defineProps<{ kind: string; defKey?: string }>();
const router = useRouter();
const meta = computed(() => kindMeta(props.kind));
const isNew = computed(() => !props.defKey);

const keyField = ref('');
const name = ref('');
// The form components edit this draft object in place. Null until loaded so forms never see a partial spec.
const spec = ref<Record<string, unknown> | null>(null);
const latest = ref<Definition | null>(null);
const versions = ref<Definition[]>([]);
const viewing = ref<Definition | null>(null);
const errors = ref<Record<string, string>>({});
const banner = ref<{ type: 'error' | 'info'; text: string } | null>(null);
const saving = ref(false);

async function load(): Promise<void> {
  errors.value = {};
  banner.value = null;
  viewing.value = null;
  spec.value = null;
  if (!meta.value) return;
  if (!props.defKey) {
    // "Duplicate" navigates here with the source in history state; the /new route mounts a fresh component.
    const copy = (history.state as { duplicate?: DuplicateState } | null)?.duplicate;
    keyField.value = '';
    name.value = copy ? `${copy.name} (copy)` : '';
    spec.value = copy ? structuredClone(copy.spec) : (meta.value.empty() as Record<string, unknown>);
    latest.value = null;
    versions.value = [];
    return;
  }
  try {
    const res = await api.definition(props.kind as DefinitionKind, props.defKey);
    latest.value = res.latest;
    versions.value = res.versions;
    keyField.value = res.latest.key;
    name.value = res.latest.name;
    spec.value = structuredClone(res.latest.spec) as Record<string, unknown>;
  } catch (err) {
    banner.value = { type: 'error', text: (err as Error).message };
  }
}
watch(() => [props.kind, props.defKey], load, { immediate: true });

async function save(): Promise<void> {
  const kind = props.kind as DefinitionKind;
  const local: Record<string, string> = {};
  if (isNew.value) {
    const k = DefinitionKey.safeParse(keyField.value);
    if (!k.success) local.key = k.error.issues[0].message;
  }
  if (!name.value.trim()) local.name = 'Required';
  const parsed = DEFINITION_KINDS[kind].safeParse(spec.value);
  if (!parsed.success) Object.assign(local, issueMap(parsed.error.issues.map((i) => ({ path: ['spec', ...i.path], message: i.message }))));
  errors.value = local;
  if (Object.keys(local).length) {
    banner.value = { type: 'error', text: `Fix ${Object.keys(local).length} field(s) highlighted below.` };
    return;
  }

  saving.value = true;
  try {
    const body = { key: keyField.value, name: name.value.trim(), spec: parsed.data };
    const saved = isNew.value ? await api.createDefinition(kind, body) : await api.updateDefinition(kind, props.defKey!, body);
    banner.value = { type: 'info', text: `Saved ${saved.key} v${saved.version}.` };
    if (isNew.value) await router.replace(`/defs/${kind}/${saved.key}`);
    else await load();
    banner.value = { type: 'info', text: `Saved v${saved.version}.` };
  } catch (err) {
    if (err instanceof ApiError) errors.value = issueMap(err.issues);
    banner.value = { type: 'error', text: (err as Error).message };
  } finally {
    saving.value = false;
  }
}

async function toggleArchive(): Promise<void> {
  if (!latest.value) return;
  await api.archiveDefinition(props.kind as DefinitionKind, latest.value.key, !latest.value.archived);
  await load();
}

function duplicate(): void {
  if (!spec.value) return;
  const duplicate: DuplicateState = { name: name.value, spec: structuredClone(toRaw(spec.value)) };
  // Specs are plain JSON, so they survive history state's structured clone.
  void router.push({ path: `/defs/${props.kind}/new`, state: { duplicate } as unknown as HistoryState });
}
</script>

<template>
  <div v-if="!meta" class="banner error">Unknown definition kind "{{ kind }}".</div>
  <div v-else>
    <div class="page-head">
      <div>
        <div class="sub"><RouterLink :to="`/defs/${kind}`">{{ meta.plural }}</RouterLink> /</div>
        <h1>
          {{ isNew ? `New ${meta.label.toLowerCase()}` : name }}
          <span v-if="latest" class="badge">v{{ latest.version }}</span>
          <span v-if="latest?.archived" class="badge skipped">archived</span>
        </h1>
      </div>
      <div class="row">
        <button v-if="!isNew" @click="duplicate">Duplicate</button>
        <button v-if="!isNew" class="danger" @click="toggleArchive">{{ latest?.archived ? 'Unarchive' : 'Archive' }}</button>
        <button class="primary" :disabled="saving" @click="save">{{ isNew ? 'Create' : 'Save new version' }}</button>
      </div>
    </div>

    <div v-if="banner" class="banner" :class="banner.type">{{ banner.text }}</div>

    <div class="card">
      <div class="grid2">
        <div>
          <label>Name</label>
          <input type="text" v-model="name" />
          <div v-if="errors.name" class="field-error">{{ errors.name }}</div>
        </div>
        <div>
          <label>Key</label>
          <input type="text" v-model="keyField" :disabled="!isNew" placeholder="e.g. csv-totals" />
          <div v-if="errors.key" class="field-error">{{ errors.key }}</div>
          <div class="hint">Stable id used in references. Lowercase, digits, dashes. Can't change later.</div>
        </div>
      </div>
      <component v-if="spec" :is="meta.form" :spec="spec" :errors="errors" />
      <div v-else-if="!banner" class="sub">Loading…</div>
    </div>

    <div v-if="versions.length" class="card">
      <h2 style="margin-top: 0">Version history</h2>
      <table>
        <thead><tr><th>Version</th><th>Name</th><th>Saved</th><th></th></tr></thead>
        <tbody>
          <tr v-for="v in versions" :key="v.id">
            <td>v{{ v.version }} <span class="sub mono">#{{ v.id }}</span></td>
            <td>{{ v.name }}</td>
            <td class="sub">{{ when(v.createdAt) }}</td>
            <td><button class="link" @click="viewing = viewing?.id === v.id ? null : v">{{ viewing?.id === v.id ? 'Hide' : 'View' }}</button></td>
          </tr>
        </tbody>
      </table>
      <pre v-if="viewing">{{ JSON.stringify(viewing.spec, null, 2) }}</pre>
    </div>
  </div>
</template>
