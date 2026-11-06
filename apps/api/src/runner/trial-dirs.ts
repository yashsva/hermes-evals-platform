import { ConfigSpec, SkillSpec, TaskSpec } from '@evals/shared';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';

/** Hermes' separator between MEMORY.md entries (tools/memory_tool_store.py ENTRY_DELIMITER). */
const MEMORY_ENTRY_DELIMITER = '\n§\n';

export interface TrialDirs {
  root: string;
  home: string;
  workspace: string;
}

export function trialDirs(trialsRoot: string, trialId: number): TrialDirs {
  const root = join(trialsRoot, `trial-${trialId}`);
  return { root, home: join(root, 'home'), workspace: join(root, 'workspace') };
}

/**
 * Builds a fresh, isolated HERMES_HOME and workspace for one trial. Everything the agent can see
 * is written here from the experiment's exact definition versions — nothing from the host's ~/.hermes.
 */
export async function prepareTrialDirs(
  dirs: TrialDirs,
  task: TaskSpec,
  config: ConfigSpec,
  skills: { key: string; spec: SkillSpec }[],
): Promise<void> {
  await rm(dirs.root, { recursive: true, force: true });
  await mkdir(join(dirs.home, 'memories'), { recursive: true });
  await mkdir(join(dirs.home, 'skills'), { recursive: true });
  await mkdir(dirs.workspace, { recursive: true });

  await writeFile(join(dirs.home, 'config.yaml'), hermesConfigYaml(config), 'utf8');

  for (const skill of skills) {
    const dir = join(dirs.home, 'skills', skill.key);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), skillMarkdown(skill.key, skill.spec), 'utf8');
  }

  if (config.memory.enabled && config.memory.entries.length > 0) {
    await writeFile(join(dirs.home, 'memories', 'MEMORY.md'), config.memory.entries.join(MEMORY_ENTRY_DELIMITER), 'utf8');
  }

  for (const file of task.files) {
    const target = join(dirs.workspace, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

/**
 * The per-trial Hermes config. Self-improvement features (background review, skill-creation and
 * memory nudges, title generation) are switched off: they add model calls and let a run change its
 * own skills/memory, which would make trials neither comparable nor independent.
 */
export function hermesConfigYaml(config: ConfigSpec): string {
  return stringify({
    model: { default: config.model, provider: config.provider },
    agent: { max_turns: config.maxTurns },
    memory: {
      memory_enabled: config.memory.enabled,
      user_profile_enabled: false,
      nudge_interval: 0,
    },
    skills: { creation_nudge_interval: 0 },
    auxiliary: {
      background_review: { enabled: false },
      title_generation: { enabled: false },
    },
    terminal: { backend: 'local', cwd: '.' },
  });
}

export function skillMarkdown(key: string, spec: SkillSpec): string {
  const frontmatter = stringify({ name: key, description: spec.description, version: '1.0.0' }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${spec.body.trim()}\n`;
}

export async function removeTrialDirs(dirs: TrialDirs): Promise<void> {
  await rm(dirs.root, { recursive: true, force: true });
}
