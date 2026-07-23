import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export * from './schema';
export { eq, and, or, not, desc, asc, like, ilike, inArray, isNull, isNotNull, gte, lte, gt, lt, count, sql, ne } from 'drizzle-orm';

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function createDb() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

// Lazy-init proxy so DATABASE_URL is resolved at first use, not module load
export const db: DbClient = new Proxy({} as DbClient, {
  get(_target, prop) {
    if (!_db) _db = createDb();
    const val = (_db as any)[prop];
    return typeof val === 'function' ? val.bind(_db) : val;
  },
});
