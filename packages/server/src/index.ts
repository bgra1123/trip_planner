import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { createDb, defaultDbPath } from "@trip-memory/store";
import { buildApp } from "./app.js";

const dbPath = process.env.DATABASE_URL ?? defaultDbPath();
mkdirSync(dirname(dbPath), { recursive: true });

const db = createDb(dbPath);
const app = buildApp(db, { webAppBaseUrl: process.env.WEB_APP_BASE_URL });

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`trip-memory server listening on :${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
