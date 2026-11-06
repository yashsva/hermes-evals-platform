import { z } from 'zod';
import { ConfigSpec } from './config';
import { SkillSpec } from './skill';
import { TaskSpec } from './task';

export * from './config';
export * from './skill';
export * from './task';

/**
 * Every user-editable definition kind and the schema its `spec` must satisfy.
 * Adding a new kind = add a schema file, register it here, and add a form in the web app.
 * The database table, API routes and list page are generic over this registry.
 */
export const DEFINITION_KINDS = {
  task: TaskSpec,
  config: ConfigSpec,
  skill: SkillSpec,
} as const;

export type DefinitionKind = keyof typeof DEFINITION_KINDS;
export type SpecOf<K extends DefinitionKind> = z.infer<(typeof DEFINITION_KINDS)[K]>;

export function isDefinitionKind(value: string): value is DefinitionKind {
  return Object.prototype.hasOwnProperty.call(DEFINITION_KINDS, value);
}

/** Keys are URL- and filesystem-safe because skills use them as directory names. */
export const DefinitionKey = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits and dashes only')
  .refine((key) => key !== 'new', '"new" is reserved');

export const DefinitionInput = z.object({
  key: DefinitionKey,
  name: z.string().min(1, 'Required').max(120),
  spec: z.unknown(),
});
export type DefinitionInput = z.infer<typeof DefinitionInput>;

export interface Definition<K extends DefinitionKind = DefinitionKind> {
  id: number;
  kind: K;
  key: string;
  version: number;
  name: string;
  spec: SpecOf<K>;
  archived: boolean;
  createdAt: string;
}
