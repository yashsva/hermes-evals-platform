import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { env } from '../common/env';

// Return numeric/bigint columns as JS numbers. Our values (costs, counts) fit comfortably.
types.setTypeParser(types.builtins.NUMERIC, (v) => Number(v));
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  readonly pool = new Pool({ connectionString: env.databaseUrl, max: 10 });

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Applies `migrations/NNN_*.sql` files in order, once each, tracked in `schema_migrations`. */
  async migrate(): Promise<void> {
    await this.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = new Set((await this.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
    const dir = join(__dirname, 'migrations');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      await this.transaction(async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });
      this.logger.log(`Applied migration ${file}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
