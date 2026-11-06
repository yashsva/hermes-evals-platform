import { z } from 'zod';

/** A Hermes skill: written to `<HERMES_HOME>/skills/<key>/SKILL.md` and preloaded with `-s <key>`. */
export const SkillSpec = z.object({
  description: z.string().min(1, 'Required').max(300),
  body: z.string().min(1, 'Required').max(20_000),
});
export type SkillSpec = z.infer<typeof SkillSpec>;
