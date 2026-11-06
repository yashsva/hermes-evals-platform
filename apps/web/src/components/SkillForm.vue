<script setup lang="ts">
import type { SkillSpec } from '@evals/shared';
import FieldError from './FieldError.vue';

defineProps<{ spec: SkillSpec; errors: Record<string, string> }>();
</script>

<template>
  <label>Description</label>
  <input type="text" v-model="spec.description" placeholder="When the agent should use this skill" />
  <FieldError :errors="errors" path="spec.description" />
  <div class="hint">Shown in the agent's skill index (frontmatter <code>description</code>).</div>

  <label>SKILL.md body (markdown)</label>
  <textarea v-model="spec.body" rows="18" placeholder="# My procedure&#10;&#10;1. …" />
  <FieldError :errors="errors" path="spec.body" />
  <div class="hint">Written to <code>skills/&lt;key&gt;/SKILL.md</code> in each trial's fresh Hermes home and preloaded with <code>-s &lt;key&gt;</code> by configs that list it.</div>
</template>
