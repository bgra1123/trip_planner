import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveTripToken, type Db } from "@trip-memory/store";
import { extractBearerToken } from "../auth.js";
import { buildTripMcpServer } from "./tripMcpServer.js";

/**
 * Mounts the MCP Streamable HTTP endpoint at /mcp. Every request resolves its
 * bearer token to a trip id first; a fresh, single-trip-scoped McpServer and
 * transport are built per request (stateless mode), so a token can never reach
 * data outside the one trip it was minted for.
 */
export function registerMcpRoute(app: FastifyInstance, db: Db, webAppBaseUrl: string): void {
  async function handle(request: FastifyRequest, reply: FastifyReply) {
    const token = extractBearerToken(request);
    if (!token) {
      reply.code(401).send({ error: "missing bearer token" });
      return;
    }
    const tripId = resolveTripToken(db, token);
    if (!tripId) {
      reply.code(403).send({ error: "invalid or revoked token" });
      return;
    }

    // Hand the raw response off to the transport before writing anything to it,
    // so Fastify doesn't also try to serialize a response for this request.
    reply.hijack();

    const server = buildTripMcpServer(db, tripId, webAppBaseUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  }

  app.post("/mcp", handle);

  // Stateless mode has no session to stream notifications into or to terminate,
  // so GET/DELETE aren't meaningful here — matches the SDK's own stateless example.
  const methodNotAllowed = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.code(405).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);
}
