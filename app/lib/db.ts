import { Pool } from 'pg';

// Cached on globalThis so `next dev`'s hot-reload doesn't open a fresh pool
// on every module re-evaluation. In production (next start) this file is
// loaded once anyway, so the cache is inert but harmless.
const g = globalThis as unknown as { __sknlpPgPool?: Pool };

export const pool =
  g.__sknlpPgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000
  });

if (process.env.NODE_ENV !== 'production') {
  g.__sknlpPgPool = pool;
}
