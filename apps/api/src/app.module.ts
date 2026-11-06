import { Module } from '@nestjs/common';
import { env } from './common/env';
import { DbService } from './db/db.service';
import { DefinitionsController } from './definitions/definitions.controller';
import { DefinitionsRepository } from './definitions/definitions.repository';
import { DefinitionsService } from './definitions/definitions.service';
import { SeedService } from './definitions/seed.service';
import { ExperimentsController } from './experiments/experiments.controller';
import { ExperimentsRepository } from './experiments/experiments.repository';
import { ExperimentsService } from './experiments/experiments.service';
import { HealthController } from './health.controller';
import { PricingService } from './pricing/pricing.service';
import { AgentAdapter } from './runner/agent-adapter';
import { FakeAdapter } from './runner/fake.adapter';
import { HermesCliAdapter } from './runner/hermes-cli.adapter';
import { RunnerService } from './runner/runner.service';

@Module({
  controllers: [DefinitionsController, ExperimentsController, HealthController],
  providers: [
    DbService,
    DefinitionsRepository,
    DefinitionsService,
    SeedService,
    ExperimentsRepository,
    ExperimentsService,
    PricingService,
    RunnerService,
    {
      provide: AgentAdapter,
      useFactory: () => (env.runner === 'fake' ? new FakeAdapter() : new HermesCliAdapter()),
    },
  ],
})
export class AppModule {}
