<script setup lang="ts">
import type { ConfigSpec } from '@evals/shared';
import { computed } from 'vue';

const props = defineProps<{ a: ConfigSpec; b: ConfigSpec; labelA?: string; labelB?: string }>();

const fmt = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(', ') : '—') : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

const rows = computed(() => {
  const fields: [string, (c: ConfigSpec) => unknown][] = [
    ['Model', (c) => c.model],
    ['Provider', (c) => c.provider],
    ['Toolsets', (c) => [...c.toolsets].sort()],
    ['Skills', (c) => [...c.skills].sort()],
    ['Memory', (c) => c.memory.enabled],
    ['Memory entries', (c) => c.memory.entries.length],
    ['Max turns', (c) => c.maxTurns],
  ];
  return fields.map(([label, get]) => {
    const a = fmt(get(props.a));
    const b = fmt(get(props.b));
    return { label, a, b, changed: a !== b };
  });
});
const changes = computed(() => rows.value.filter((r) => r.changed).length);
</script>

<template>
  <div>
    <table>
      <thead><tr><th>Setting</th><th>{{ labelA ?? 'A' }}</th><th>{{ labelB ?? 'B' }}</th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.label" :class="{ 'diff-changed': r.changed }">
          <td>{{ r.label }}</td><td class="mono">{{ r.a }}</td><td class="mono">{{ r.b }}</td>
        </tr>
      </tbody>
    </table>
    <div class="hint" style="margin-top: 6px">
      <template v-if="changes === 0">Identical configs: this is an A/A test. A correct platform reports "inconclusive".</template>
      <template v-else-if="changes === 1">One setting differs, so any difference can be attributed to it (an ablation).</template>
      <template v-else>{{ changes }} settings differ: a difference can't be attributed to any single one.</template>
    </div>
  </div>
</template>
