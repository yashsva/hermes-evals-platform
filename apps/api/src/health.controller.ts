import { Controller, Get } from '@nestjs/common';
import { env } from './common/env';
import { DbService } from './db/db.service';
import { AgentAdapter } from './runner/agent-adapter';

@Controller('api/health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly adapter: AgentAdapter,
  ) {}

  @Get()
  async health() {
    await this.db.query('SELECT 1');
    return {
      ok: true,
      runner: this.adapter.name,
      agentVersion: await this.adapter.version(),
      // Presence only — the key itself is never returned.
      providerKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY),
      concurrency: env.concurrency,
    };
  }
}
