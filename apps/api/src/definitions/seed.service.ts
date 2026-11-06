import { Injectable, Logger } from '@nestjs/common';
import { DefinitionKind } from '@evals/shared';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DefinitionsRepository } from './definitions.repository';
import { DefinitionsService } from './definitions.service';

/** Order matters: configs reference skills. */
const SEED_ORDER: DefinitionKind[] = ['skill', 'config', 'task'];

/**
 * Inserts the sample task set on first boot (empty database only). Seeds go through the same
 * validation as the UI, so a broken seed file fails loudly at startup.
 */
@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly repo: DefinitionsRepository,
    private readonly service: DefinitionsService,
  ) {}

  async seedIfEmpty(seedDir = join(__dirname, '..', '..', 'seed')): Promise<void> {
    if (!(await this.repo.isEmpty())) return;
    let count = 0;
    for (const kind of SEED_ORDER) {
      const dir = join(seedDir, `${kind}s`);
      if (!existsSync(dir)) continue;
      for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
        const body = JSON.parse(await readFile(join(dir, file), 'utf8'));
        try {
          await this.service.create(kind, body);
        } catch (err) {
          const detail = (err as { response?: unknown }).response;
          throw new Error(`Seed ${kind}s/${file} is invalid: ${JSON.stringify(detail ?? (err as Error).message)}`);
        }
        count++;
      }
    }
    this.logger.log(`Seeded ${count} definitions from ${seedDir}`);
  }
}
