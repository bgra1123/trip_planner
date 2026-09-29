import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveTripToken, type Db } from "@trip-memory/store";

export function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/**
 * Resolves the request's bearer token and asserts it is scoped to `tripId`. On
 * failure it sends the 401/403 response itself and returns false — callers must
 * check the return value and stop handling when it is false.
 */
export function requireTripAccess(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  tripId: string,
): boolean {
  const token = extractBearerToken(request);
  if (!token) {
    reply.code(401).send({ error: "missing bearer token" });
    return false;
  }
  const scopedTripId = resolveTripToken(db, token);
  if (!scopedTripId || scopedTripId !== tripId) {
    reply.code(403).send({ error: "token is not valid for this trip" });
    return false;
  }
  return true;
}
