import { Injectable } from '@nestjs/common';
import { Definition, DefinitionKind } from '@evals/shared';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

interface DefinitionRow {
  id: number;
  kind: DefinitionKind;
  key: string;
  version: number;
  name: string;
  spec: unknown;
  archived: boolean;
  created_at: Date;
}

function toDefinition(row: DefinitionRow): Definition {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    version: row.version,
    name: row.name,
    spec: row.spec as Definition['spec'],
    archived: row.archived,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class DefinitionsRepository {
  constructor(private readonly db: DbService) {}

  /** Latest version of every key of a kind. */
  async listLatest(kind: DefinitionKind, includeArchived: boolean): Promise<Definition[]> {
    const rows = await this.db.query<DefinitionRow>(
      `SELECT DISTINCT ON (key) * FROM definitions
       WHERE kind = $1
       ORDER BY key, version DESC`,
      [kind],
    );
    return rows.filter((r) => includeArchived || !r.archived).map(toDefinition);
  }

  async findLatest(kind: DefinitionKind, key: string): Promise<Definition | undefined> {
    const row = await this.db.one<DefinitionRow>(
      'SELECT * FROM definitions WHERE kind = $1 AND key = $2 ORDER BY version DESC LIMIT 1',
      [kind, key],
    );
    return row && toDefinition(row);
  }

  async versions(kind: DefinitionKind, key: string): Promise<Definition[]> {
    const rows = await this.db.query<DefinitionRow>(
      'SELECT * FROM definitions WHERE kind = $1 AND key = $2 ORDER BY version DESC',
      [kind, key],
    );
    return rows.map(toDefinition);
  }

  async findById(id: number): Promise<Definition | undefined> {
    const row = await this.db.one<DefinitionRow>('SELECT * FROM definitions WHERE id = $1', [id]);
    return row && toDefinition(row);
  }

  async findByIds(ids: number[]): Promise<Definition[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.query<DefinitionRow>('SELECT * FROM definitions WHERE id = ANY($1::int[])', [ids]);
    return rows.map(toDefinition);
  }

  /**
   * Inserts the next version of `key`. Runs in a transaction with a row lock on the key's latest
   * version so two concurrent saves can't both claim the same version number.
   */
  async insertVersion(
    kind: DefinitionKind,
    key: string,
    name: string,
    spec: unknown,
    expectExisting: boolean,
  ): Promise<Definition | 'exists' | 'missing'> {
    try {
      return await this.insertVersionTx(kind, key, name, spec, expectExisting);
    } catch (err) {
      // A concurrent save took the same version number first (FOR UPDATE can't lock a row that doesn't exist yet).
      if ((err as { code?: string }).code === '23505') return 'exists';
      throw err;
    }
  }

  private insertVersionTx(
    kind: DefinitionKind,
    key: string,
    name: string,
    spec: unknown,
    expectExisting: boolean,
  ): Promise<Definition | 'exists' | 'missing'> {
    return this.db.transaction(async (client: PoolClient) => {
      const latest = await client.query<DefinitionRow>(
        'SELECT * FROM definitions WHERE kind = $1 AND key = $2 ORDER BY version DESC LIMIT 1 FOR UPDATE',
        [kind, key],
      );
      const current = latest.rows[0];
      if (expectExisting && !current) return 'missing';
      if (!expectExisting && current) return 'exists';
      const inserted = await client.query<DefinitionRow>(
        `INSERT INTO definitions (kind, key, version, name, spec, archived)
         VALUES ($1, $2, $3, $4, $5, false) RETURNING *`,
        [kind, key, (current?.version ?? 0) + 1, name, JSON.stringify(spec)],
      );
      return toDefinition(inserted.rows[0]);
    });
  }

  /** Archiving applies to every version of a key, so old experiments still resolve their exact rows. */
  async setArchived(kind: DefinitionKind, key: string, archived: boolean): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      'UPDATE definitions SET archived = $3 WHERE kind = $1 AND key = $2 RETURNING id',
      [kind, key, archived],
    );
    return rows.length;
  }

  async isEmpty(): Promise<boolean> {
    const row = await this.db.one<{ n: number }>('SELECT count(*)::int AS n FROM definitions');
    return (row?.n ?? 0) === 0;
  }
}
