import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { createDb, defaultDbPath } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const dbPath = process.env.DATABASE_URL ?? defaultDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = createDb(dbPath);
  migrate(db, { migrationsFolder: join(__dirname, "..", "drizzle") });
  console.log(`Migrated ${dbPath}`);
}

main();
