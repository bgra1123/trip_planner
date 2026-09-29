import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as schema from "./schema.js";
import type { Db } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** An in-memory, fully migrated DB for tests — never touches disk. */
export function createTestDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(__dirname, "..", "drizzle") });
  return db;
}
