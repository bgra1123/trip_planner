import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The DB path every entry point falls back to when DATABASE_URL isn't set —
 * `<repo root>/data/trip-memory.db`. Centralized here so `pnpm db:migrate` and
 * `pnpm dev:server` always resolve to the same file without each having to agree
 * on a relative path independently.
 */
export function defaultDbPath(): string {
  return join(__dirname, "..", "..", "..", "data", "trip-memory.db");
}
