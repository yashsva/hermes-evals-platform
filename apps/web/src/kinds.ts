import type { Component } from 'vue';
import { DEFINITION_KINDS, type ConfigSpec, type Definition, type DefinitionKind, type SkillSpec, type TaskSpec } from '@evals/shared';
import ConfigForm from './components/ConfigForm.vue';
import SkillForm from './components/SkillForm.vue';
import TaskForm from './components/TaskForm.vue';

export interface KindMeta {
  label: string;
  plural: string;
  description: string;
  form: Component;
  /** Starting spec for the "New" form. */
  empty: () => unknown;
  /** One-line summary shown in the list page. */
  summary: (def: Definition) => string;
}

/**
 * UI side of the definition registry. A new kind = a Zod schema in @evals/shared plus one entry here
 * with its form component. The list and edit pages are generic.
 */
export const KINDS: Record<DefinitionKind, KindMeta> = {
  task: {
    label: 'Task',
    plural: 'Tasks',
    description: 'A prompt, the files the agent starts with, and the checks that score its work.',
    form: TaskForm,
    empty: (): Partial<TaskSpec> => ({ prompt: '', tags: [], files: [], checks: [], passThreshold: 1, timeoutSec: 180 }),
    summary: (d) => {
      const s = d.spec as TaskSpec;
      return `${s.checks.length} check(s), ${s.files.length} file(s)${s.tags.length ? ` · ${s.tags.join(', ')}` : ''}`;
    },
  },
  config: {
    label: 'Config',
    plural: 'Configs',
    description: 'An agent configuration: model, toolsets, preloaded skills and memory.',
    form: ConfigForm,
    empty: (): ConfigSpec => ({ provider: 'openrouter', model: '', toolsets: ['file', 'terminal'], skills: [], memory: { enabled: false, entries: [] }, maxTurns: 8 }),
    summary: (d) => {
      const s = d.spec as ConfigSpec;
      return `${s.model} · tools: ${s.toolsets.join(', ') || 'none'} · skills: ${s.skills.join(', ') || 'none'} · memory: ${s.memory.enabled ? 'on' : 'off'}`;
    },
  },
  skill: {
    label: 'Skill',
    plural: 'Skills',
    description: 'A SKILL.md procedure that configs can preload into the agent prompt.',
    form: SkillForm,
    empty: (): SkillSpec => ({ description: '', body: '' }),
    summary: (d) => (d.spec as SkillSpec).description,
  },
};

export function kindMeta(kind: string): KindMeta | undefined {
  return Object.prototype.hasOwnProperty.call(DEFINITION_KINDS, kind) ? KINDS[kind as DefinitionKind] : undefined;
}
