<script setup lang="ts">
import { KNOWN_TOOLSETS, type ConfigSpec, type Definition } from '@evals/shared';
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import FieldError from './FieldError.vue';

const props = defineProps<{ spec: ConfigSpec; errors: Record<string, string> }>();
const skills = ref<Definition<'skill'>[]>([]);
onMounted(async () => {
  skills.value = await api.definitions('skill');
});

const otherToolsets = computed({
  get: () => props.spec.toolsets.filter((t) => !(KNOWN_TOOLSETS as readonly string[]).includes(t)).join(', '),
  set: (value: string) => {
    const known = props.spec.toolsets.filter((t) => (KNOWN_TOOLSETS as readonly string[]).includes(t));
    const extra = value.split(',').map((s) => s.trim()).filter(Boolean);
    props.spec.toolsets = [...known, ...extra];
  },
});

function toggle(list: string[], value: string): void {
  const idx = list.indexOf(value);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(value);
}

function addMemory(): void {
  props.spec.memory.entries.push('');
}
</script>

<template>
  <div class="grid2">
    <div>
      <label>Model</label>
      <input type="text" v-model.trim="spec.model" placeholder="e.g. openai/gpt-4o-mini" />
      <FieldError :errors="errors" path="spec.model" />
      <div class="hint">OpenRouter model id (see openrouter.ai/models). Prices are looked up from OpenRouter.</div>
    </div>
    <div>
      <label>Provider</label>
      <input type="text" v-model.trim="spec.provider" />
      <FieldError :errors="errors" path="spec.provider" />
    </div>
  </div>

  <label>Toolsets</label>
  <div class="row">
    <label v-for="t in KNOWN_TOOLSETS" :key="t" class="inline">
      <input type="checkbox" :checked="spec.toolsets.includes(t)" @change="toggle(spec.toolsets, t)" /> {{ t }}
    </label>
  </div>
  <input type="text" v-model.lazy="otherToolsets" placeholder="Other Hermes toolsets, comma-separated" style="margin-top: 6px" />
  <FieldError :errors="errors" path="spec.toolsets" />

  <label>Preloaded skills</label>
  <div class="row">
    <label v-for="s in skills" :key="s.key" class="inline">
      <input type="checkbox" :checked="spec.skills.includes(s.key)" @change="toggle(spec.skills, s.key)" /> {{ s.name }}
      <span class="sub mono">({{ s.key }})</span>
    </label>
    <span v-if="skills.length === 0" class="sub">No skills defined yet.</span>
  </div>
  <FieldError :errors="errors" path="spec.skills" />
  <div class="hint">Resolved to the skill's latest version when an experiment starts, then pinned.</div>

  <label>Memory</label>
  <label class="inline"><input type="checkbox" v-model="spec.memory.enabled" /> Enable Hermes memory (MEMORY.md + memory tool)</label>
  <div v-if="spec.memory.enabled">
    <div class="hint">Entries seeded into MEMORY.md before each run (one fact per entry). Also tick the <code>memory</code> toolset if the agent should be able to write memories.</div>
    <div v-for="(_, i) in spec.memory.entries" :key="i" class="row" style="margin-top: 6px">
      <input type="text" v-model="spec.memory.entries[i]" style="flex: 1" />
      <button class="danger" @click="spec.memory.entries.splice(i, 1)">Remove</button>
      <FieldError :errors="errors" :path="`spec.memory.entries.${i}`" />
    </div>
    <button style="margin-top: 6px" @click="addMemory">Add memory entry</button>
  </div>

  <div class="grid2">
    <div>
      <label>Max turns</label>
      <input type="number" v-model.number="spec.maxTurns" min="1" max="50" />
      <FieldError :errors="errors" path="spec.maxTurns" />
      <div class="hint">Tool-calling iterations before Hermes stops. Bounds cost per trial.</div>
    </div>
  </div>
</template>
