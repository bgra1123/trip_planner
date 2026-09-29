# Trip Memory

Monorepo: core (pure logic) → store (Drizzle) → server (API + MCP) → web, extension.

## Invariants
- `packages/core` has no I/O and no dependency on store/server. Pure functions only.
- Types are inferred from Zod schemas in core/src/schema.ts. Never hand-write a
  parallel TS interface.
- Derived values (budget, gaps, conflicts) are computed on read, never stored.
- Agents can only write `status: 'idea'`. Only a user action promotes to `booked`.
- Agent-supplied places go through resolvePlace(). Unresolved places are persisted
  but flagged, never silently accepted.
- Agent-supplied prices never populate `cost`. They live in `raw` and render as
  unverified.
- Expired items are hidden from agent context but never deleted.
- MCP tokens are scoped to exactly one trip.

## Commands
pnpm test | pnpm dev:server | pnpm dev:web | pnpm db:migrate

## Style
Small modules. Tests alongside source as *.test.ts. No default exports.
