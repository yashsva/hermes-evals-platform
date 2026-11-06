import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ConfigSpec,
  Definition,
  DefinitionInput,
  DefinitionKind,
  DEFINITION_KINDS,
  isDefinitionKind,
} from '@evals/shared';
import { ZodTypeAny } from 'zod';
import { parseOrThrow } from '../common/validation';
import { DefinitionsRepository } from './definitions.repository';

@Injectable()
export class DefinitionsService {
  constructor(private readonly repo: DefinitionsRepository) {}

  kind(value: string): DefinitionKind {
    if (!isDefinitionKind(value)) {
      throw new NotFoundException(`Unknown definition kind "${value}". Known: ${Object.keys(DEFINITION_KINDS).join(', ')}`);
    }
    return value;
  }

  list(kind: DefinitionKind, includeArchived: boolean): Promise<Definition[]> {
    return this.repo.listLatest(kind, includeArchived);
  }

  async get(kind: DefinitionKind, key: string): Promise<{ latest: Definition; versions: Definition[] }> {
    const versions = await this.repo.versions(kind, key);
    if (versions.length === 0) throw new NotFoundException(`${kind} "${key}" not found`);
    return { latest: versions[0], versions };
  }

  async getById(id: number): Promise<Definition> {
    const def = await this.repo.findById(id);
    if (!def) throw new NotFoundException(`Definition ${id} not found`);
    return def;
  }

  async create(kind: DefinitionKind, body: unknown): Promise<Definition> {
    const input = parseOrThrow(DefinitionInput, body);
    const spec = await this.validateSpec(kind, input.spec);
    const result = await this.repo.insertVersion(kind, input.key, input.name, spec, false);
    if (result === 'exists') throw new ConflictException(`${kind} "${input.key}" already exists — edit it instead`);
    if (result === 'missing') throw new Error('unreachable');
    return result;
  }

  /** Saving an edit never mutates history: it inserts version N+1. */
  async update(kind: DefinitionKind, key: string, body: unknown): Promise<Definition> {
    const input = parseOrThrow(DefinitionInput, { ...(body as object), key });
    const spec = await this.validateSpec(kind, input.spec);
    const result = await this.repo.insertVersion(kind, key, input.name, spec, true);
    if (result === 'missing') throw new NotFoundException(`${kind} "${key}" not found`);
    if (result === 'exists') throw new ConflictException(`${kind} "${key}" was saved by someone else just now — reload and retry`);
    return result;
  }

  async setArchived(kind: DefinitionKind, key: string, archived: boolean): Promise<void> {
    const changed = await this.repo.setArchived(kind, key, archived);
    if (changed === 0) throw new NotFoundException(`${kind} "${key}" not found`);
  }

  private async validateSpec(kind: DefinitionKind, raw: unknown): Promise<unknown> {
    const schema: ZodTypeAny = DEFINITION_KINDS[kind];
    const spec: unknown = parseOrThrow(schema, raw, 'spec');
    if (kind === 'config') await this.assertSkillsExist(spec as ConfigSpec);
    return spec;
  }

  /** Cross-definition rule the per-kind schema can't express: referenced skills must exist and be active. */
  private async assertSkillsExist(config: ConfigSpec): Promise<void> {
    const active = new Set((await this.repo.listLatest('skill', false)).map((s) => s.key));
    const missing = config.skills.filter((key) => !active.has(key));
    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: [{ path: 'spec.skills', message: `Unknown or archived skill(s): ${missing.join(', ')}` }],
      });
    }
  }
}
