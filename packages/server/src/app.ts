import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  buildAgentContext,
  CreateItemInputSchema,
  CreateSegmentInputSchema,
  CreateTripInputSchema,
  deriveGaps,
  resolveEffectiveSegments,
  UpdateItemInputSchema,
  UpdateSegmentInputSchema,
} from "@trip-memory/core";
import {
  createItem,
  createSegment,
  createTrip,
  deleteItem,
  getItem,
  getSegment,
  getTrip,
  listItems,
  listPreferences,
  listSegments,
  mintTripToken,
  updateItem,
  updateSegment,
  type Db,
} from "@trip-memory/store";
import { requireTripAccess } from "./auth.js";
import { registerMcpRoute } from "./mcp/route.js";

export type BuildAppOptions = {
  webAppBaseUrl?: string;
};

export function buildApp(db: Db, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const webAppBaseUrl = options.webAppBaseUrl ?? "http://localhost:5173";

  app.register(cors, {
    origin: [webAppBaseUrl],
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization"],
  });

  app.post("/trips", async (request, reply) => {
    const parsed = CreateTripInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const trip = createTrip(db, parsed.data);
    const token = mintTripToken(db, trip.id, "initial");
    return reply.code(201).send({ trip, token: token.token });
  });

  app.get<{ Params: { id: string } }>("/trips/:id", async (request, reply) => {
    const trip = getTrip(db, request.params.id);
    if (!trip) return reply.code(404).send({ error: "trip not found" });
    if (!requireTripAccess(db, request, reply, trip.id)) return;

    const segments = listSegments(db, trip.id);
    const items = listItems(db, trip.id);
    return { trip, segments, items };
  });

  app.post<{ Params: { id: string } }>("/trips/:id/segments", async (request, reply) => {
    const trip = getTrip(db, request.params.id);
    if (!trip) return reply.code(404).send({ error: "trip not found" });
    if (!requireTripAccess(db, request, reply, trip.id)) return;

    const parsed = CreateSegmentInputSchema.safeParse({ ...(request.body as object), trip_id: trip.id });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    return reply.code(201).send(createSegment(db, parsed.data));
  });

  app.patch<{ Params: { id: string } }>("/segments/:id", async (request, reply) => {
    const existing = getSegment(db, request.params.id);
    if (!existing) return reply.code(404).send({ error: "segment not found" });
    if (!requireTripAccess(db, request, reply, existing.trip_id)) return;

    const parsed = UpdateSegmentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    return updateSegment(db, existing.id, parsed.data);
  });

  app.post<{ Params: { id: string } }>("/trips/:id/items", async (request, reply) => {
    const trip = getTrip(db, request.params.id);
    if (!trip) return reply.code(404).send({ error: "trip not found" });
    if (!requireTripAccess(db, request, reply, trip.id)) return;

    const parsed = CreateItemInputSchema.safeParse({ ...(request.body as object), trip_id: trip.id });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    return reply.code(201).send(createItem(db, parsed.data));
  });

  app.patch<{ Params: { id: string } }>("/items/:id", async (request, reply) => {
    const existing = getItem(db, request.params.id);
    if (!existing) return reply.code(404).send({ error: "item not found" });
    if (!requireTripAccess(db, request, reply, existing.trip_id)) return;

    const parsed = UpdateItemInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    return updateItem(db, existing.id, parsed.data);
  });

  app.delete<{ Params: { id: string } }>("/items/:id", async (request, reply) => {
    const existing = getItem(db, request.params.id);
    if (!existing) return reply.code(404).send({ error: "item not found" });
    if (!requireTripAccess(db, request, reply, existing.trip_id)) return;

    deleteItem(db, existing.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/trips/:id/context", async (request, reply) => {
    const trip = getTrip(db, request.params.id);
    if (!trip) return reply.code(404).send({ error: "trip not found" });
    if (!requireTripAccess(db, request, reply, trip.id)) return;

    const items = listItems(db, trip.id);
    const segments = resolveEffectiveSegments(listSegments(db, trip.id), items);
    const preferences = listPreferences(db, trip.id);
    return buildAgentContext(trip, segments, items, preferences);
  });

  app.get<{ Params: { id: string } }>("/trips/:id/gaps", async (request, reply) => {
    const trip = getTrip(db, request.params.id);
    if (!trip) return reply.code(404).send({ error: "trip not found" });
    if (!requireTripAccess(db, request, reply, trip.id)) return;

    const items = listItems(db, trip.id);
    const segments = resolveEffectiveSegments(listSegments(db, trip.id), items);
    return deriveGaps(trip, segments, items);
  });

  app.post<{ Params: { id: string }; Body: { label?: string } }>(
    "/trips/:id/tokens",
    async (request, reply) => {
      const trip = getTrip(db, request.params.id);
      if (!trip) return reply.code(404).send({ error: "trip not found" });
      if (!requireTripAccess(db, request, reply, trip.id)) return;

      const token = mintTripToken(db, trip.id, request.body?.label ?? null);
      return reply.code(201).send(token);
    },
  );

  registerMcpRoute(app, db, webAppBaseUrl);

  return app;
}
