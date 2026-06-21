/**
 * GET /cache/debug?prefix=<x>
 *
 * Shows which Redis node owns the prefix and whether it's currently cached.
 * Useful for viva demo — run this to show the hash ring in action.
 *
 * Response:
 * {
 *   prefix,
 *   cacheKey,
 *   node: { id, host, port },
 *   keyHash,        ← the FNV-1a hash of the key
 *   ringSize,       ← total virtual nodes on the ring (3 × 150 = 450)
 *   hit: true|false,
 *   cachedValue: [...] | null
 * }
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { redisRouter } from "../cache/redisRouter";

interface DebugQuery {
  prefix?: string;
}

export async function cacheDebugRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: DebugQuery }>(
    "/cache/debug",
    async (
      request: FastifyRequest<{ Querystring: DebugQuery }>,
      reply: FastifyReply
    ) => {
      const prefix = (request.query.prefix ?? "").toLowerCase().trim();
      const cacheKey = `suggest:${prefix}:c`;

      const debugInfo = redisRouter.debugNode(cacheKey);
      const cached = await redisRouter.peek(cacheKey);

      return reply.send({
        prefix,
        cacheKey,
        node: {
          id: debugInfo.node.id,
          host: debugInfo.node.host,
          port: debugInfo.node.port,
        },
        keyHash: debugInfo.keyHash,
        ringSize: debugInfo.ringSize,
        hit: cached !== null,
        cachedValue: cached !== null ? JSON.parse(cached) : null,
      });
    }
  );
}
