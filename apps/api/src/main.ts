import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppModule } from './app.module';
import { env } from './common/env';
import { DbService } from './db/db.service';
import { SeedService } from './definitions/seed.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  app.useBodyParser('json', { limit: '5mb' });

  // Schema and sample data must exist before the runner starts claiming trials (on listen).
  await app.get(DbService).migrate();
  if (env.seedOnEmpty) await app.get(SeedService).seedIfEmpty();

  // In the container the API also serves the built Vue app, so everything is on one port.
  if (env.webDist && existsSync(env.webDist)) {
    const webDist = resolve(env.webDist);
    const index = join(webDist, 'index.html');
    app.useStaticAssets(webDist);
    app.use((req: { method: string; path: string }, res: { sendFile: (p: string) => void }, next: () => void) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) res.sendFile(index);
      else next();
    });
  }

  await app.listen(env.port, '0.0.0.0');
  new Logger('Bootstrap').log(`Listening on http://localhost:${env.port} (runner: ${env.runner})`);
}

void bootstrap();
