# Trip Memory

A shared trip store with three surfaces: a browser extension that captures offers, a web app
that visualizes and optimizes the itinerary, and an MCP connector that exposes trip context to
ChatGPT/Claude and writes proposals back.

Everything is one data model, defined in `packages/core`. The other packages are read/write
paths into it.

## Packages

- `packages/core` — Zod schema, TS types, derived logic (gaps, budget, conflicts). No I/O.
- `packages/store` — Drizzle ORM schema, migrations, repository functions over SQLite.
- `packages/server` — Fastify REST API + MCP server (Streamable HTTP transport).
- `packages/web` — React app (inbox, timeline, budget strip).
- `packages/extension` — MV3 browser extension for capturing offers.

## Getting started

```bash
pnpm install
pnpm test
pnpm db:migrate
pnpm dev:server
pnpm dev:web
```

See `CLAUDE.md` for the invariants this codebase depends on.
