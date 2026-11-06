<script setup lang="ts">
import type { Check, CheckType, TaskSpec } from '@evals/shared';
import { computed } from 'vue';
import FieldError from './FieldError.vue';

const props = defineProps<{ spec: TaskSpec; errors: Record<string, string> }>();

const CHECK_TYPES: { type: CheckType; label: string; help: string }[] = [
  { type: 'contains', label: 'Contains text', help: 'Passes if the text appears in the answer or a file.' },
  { type: 'regex', label: 'Matches regex', help: 'Passes if the pattern matches the answer or a file.' },
  { type: 'json', label: 'JSON field equals', help: 'Parses JSON (fenced block or first {...}) and compares one field.' },
  { type: 'script', label: 'Hidden test script', help: 'Runs after the agent finishes, in its workspace. Exit 0 = pass. The agent never sees it.' },
];

function newCheck(type: CheckType, base?: Partial<Check>): Check {
  const common = { name: base?.name ?? '', weight: base?.weight ?? 1, required: base?.required ?? false };
  const target = base && 'target' in base && base.target ? base.target : { kind: 'answer' as const };
  switch (type) {
    case 'contains':
      return { ...common, type, target, value: '', caseSensitive: false };
    case 'regex':
      return { ...common, type, target, pattern: '', flags: '' };
    case 'json':
      return { ...common, type, target, field: '', equals: '' };
    case 'script':
      return { ...common, type, language: 'python', code: '' };
  }
}

function changeType(i: number, type: CheckType): void {
  props.spec.checks[i] = newCheck(type, props.spec.checks[i]);
}

function setTarget(check: Check, kind: 'answer' | 'file'): void {
  if (check.type === 'script') return;
  check.target = kind === 'answer' ? { kind } : { kind, path: '' };
}

function setEquals(check: Check, raw: string): void {
  if (check.type !== 'json') return;
  const trimmed = raw.trim();
  check.equals = trimmed === 'true' ? true : trimmed === 'false' ? false : trimmed !== '' && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : raw;
}

function move(i: number, delta: number): void {
  const list = props.spec.checks;
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

const tags = computed({
  get: () => props.spec.tags.join(', '),
  set: (v: string) => (props.spec.tags = v.split(',').map((s) => s.trim()).filter(Boolean)),
});

const totalWeight = computed(() => props.spec.checks.reduce((s, c) => s + (Number(c.weight) || 0), 0));
const help = (type: CheckType) => CHECK_TYPES.find((t) => t.type === type)?.help;
</script>

<template>
  <label>Prompt</label>
  <textarea v-model="spec.prompt" rows="6" placeholder="What the agent is asked to do" />
  <FieldError :errors="errors" path="spec.prompt" />

  <div class="grid2">
    <div>
      <label>Tags</label>
      <input type="text" v-model.lazy="tags" placeholder="e.g. skill, control" />
      <div class="hint">Used to group and select tasks in experiments.</div>
    </div>
    <div class="grid2">
      <div>
        <label>Pass threshold</label>
        <input type="number" v-model.number="spec.passThreshold" min="0" max="1" step="0.05" />
        <FieldError :errors="errors" path="spec.passThreshold" />
      </div>
      <div>
        <label>Timeout (s)</label>
        <input type="number" v-model.number="spec.timeoutSec" min="10" max="1800" />
        <FieldError :errors="errors" path="spec.timeoutSec" />
      </div>
    </div>
  </div>

  <h3>Workspace files</h3>
  <div class="hint">Copied into the agent's empty working directory before each run.</div>
  <div v-for="(file, i) in spec.files" :key="i" class="subform">
    <div class="subform-head">
      <input type="text" v-model.trim="file.path" placeholder="path/inside/workspace.txt" class="mono" />
      <button class="danger" @click="spec.files.splice(i, 1)">Remove</button>
    </div>
    <FieldError :errors="errors" :path="`spec.files.${i}.path`" />
    <textarea v-model="file.content" rows="5" style="margin-top: 6px" />
  </div>
  <button @click="spec.files.push({ path: '', content: '' })">Add file</button>

  <h3>Checks <span class="sub">(score = passed weight / total weight {{ totalWeight }})</span></h3>
  <FieldError :errors="errors" path="spec.checks" />
  <div v-for="(check, i) in spec.checks" :key="i" class="subform">
    <div class="subform-head">
      <strong>#{{ i + 1 }}</strong>
      <button class="link" @click="move(i, -1)" :disabled="i === 0">↑</button>
      <button class="link" @click="move(i, 1)" :disabled="i === spec.checks.length - 1">↓</button>
      <button class="danger" @click="spec.checks.splice(i, 1)">Remove</button>
    </div>
    <div class="grid2">
      <div>
        <label>Name</label>
        <input type="text" v-model="check.name" placeholder="What this verifies" />
        <FieldError :errors="errors" :path="`spec.checks.${i}.name`" />
      </div>
      <div>
        <label>Type</label>
        <select :value="check.type" @change="changeType(i, ($event.target as HTMLSelectElement).value as CheckType)">
          <option v-for="t in CHECK_TYPES" :key="t.type" :value="t.type">{{ t.label }}</option>
        </select>
        <div class="hint">{{ help(check.type) }}</div>
      </div>
    </div>

    <template v-if="check.type !== 'script'">
      <div class="grid2">
        <div>
          <label>Look in</label>
          <select :value="check.target.kind" @change="setTarget(check, ($event.target as HTMLSelectElement).value as 'answer' | 'file')">
            <option value="answer">Final answer</option>
            <option value="file">A file in the workspace</option>
          </select>
        </div>
        <div v-if="check.target.kind === 'file'">
          <label>File path</label>
          <input type="text" v-model.trim="check.target.path" class="mono" />
          <FieldError :errors="errors" :path="`spec.checks.${i}.target.path`" />
        </div>
      </div>
    </template>

    <template v-if="check.type === 'contains'">
      <label>Text</label>
      <input type="text" v-model="check.value" />
      <FieldError :errors="errors" :path="`spec.checks.${i}.value`" />
      <label class="inline" style="margin-top: 6px"><input type="checkbox" v-model="check.caseSensitive" /> Case sensitive</label>
    </template>

    <template v-else-if="check.type === 'regex'">
      <div class="grid2">
        <div>
          <label>Pattern</label>
          <input type="text" v-model="check.pattern" class="mono" />
          <FieldError :errors="errors" :path="`spec.checks.${i}.pattern`" />
        </div>
        <div>
          <label>Flags</label>
          <input type="text" v-model.trim="check.flags" class="mono" placeholder="i, m, s, u" />
          <FieldError :errors="errors" :path="`spec.checks.${i}.flags`" />
        </div>
      </div>
    </template>

    <template v-else-if="check.type === 'json'">
      <div class="grid2">
        <div>
          <label>Field (dot path)</label>
          <input type="text" v-model.trim="check.field" class="mono" placeholder="totals.north" />
          <FieldError :errors="errors" :path="`spec.checks.${i}.field`" />
        </div>
        <div>
          <label>Equals</label>
          <input type="text" :value="String(check.equals)" @change="setEquals(check, ($event.target as HTMLInputElement).value)" class="mono" />
          <div class="hint">Numbers compare numerically; text compares case-insensitively.</div>
        </div>
      </div>
    </template>

    <template v-else-if="check.type === 'script'">
      <label>Language</label>
      <select v-model="check.language">
        <option value="python">Python</option>
        <option value="bash">Bash</option>
      </select>
      <label>Code</label>
      <textarea v-model="check.code" rows="8" placeholder="Runs with the agent's workspace as the current directory" />
      <FieldError :errors="errors" :path="`spec.checks.${i}.code`" />
    </template>

    <div class="row" style="margin-top: 8px">
      <label class="inline">Weight <input type="number" v-model.number="check.weight" min="0.1" step="0.5" style="width: 80px" /></label>
      <label class="inline"><input type="checkbox" v-model="check.required" /> Required to pass</label>
    </div>
  </div>
  <button @click="spec.checks.push(newCheck('contains'))">Add check</button>
</template>
