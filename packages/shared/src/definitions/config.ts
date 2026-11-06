import { z } from 'zod';

/** Toolsets offered in the config form. Hermes accepts more; these are the ones that make sense for local evals. */
export const KNOWN_TOOLSETS = ['file', 'terminal', 'memory', 'skills', 'todo', 'web'] as const;

/** An agent configuration: everything that may differ between the two arms of an experiment. */
export const ConfigSpec = z.object({
  provider: z.string().min(1).default('openrouter'),
  model: z.string().min(1, 'Required'),
  toolsets: z.array(z.string().min(1)).default(['file', 'terminal']),
  /** Keys of skill definitions to preload. Resolved to exact versions when an experiment starts. */
  skills: z.array(z.string().min(1)).default([]),
  memory: z
    .object({
      enabled: z.boolean().default(false),
      /** Entries written to MEMORY.md before the run, one fact per entry. */
      entries: z.array(z.string().min(1).max(500)).max(20).default([]),
    })
    .default({}),
  maxTurns: z.number().int().min(1).max(50).default(8),
});
export type ConfigSpec = z.infer<typeof ConfigSpec>;
