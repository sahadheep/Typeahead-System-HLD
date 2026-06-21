/**
 * POST /search
 * Body: { query: string }
 * Returns: { message: "Searched", query: string }
 *
 * Enqueues the query to BatchWriter (Phase 5 pattern):
 * - Trie count is updated immediately (fresh suggestions within milliseconds)
 * - SQLite write is deferred to next batch flush
 *
 * Cache invalidation: deletes the cache entry for this prefix so the
 * next /suggest call picks up the updated count.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BatchWriter } from "../workers/batchWriter";
import { redisRouter } from "../cache/redisRouter";

interface SearchBody {
  query: string;
}

export async function searchRoute(
  fastify: FastifyInstance,
  batchWriter: BatchWriter
): Promise<void> {
  fastify.post<{ Body: SearchBody }>(
    "/search",
    {
      schema: {
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
              query: { type: "string" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: SearchBody }>,
      reply: FastifyReply
    ) => {
      const query = request.body.query.trim();
      if (!query) {
        return reply.status(400).send({ error: "Query cannot be empty" });
      }

      // Enqueue — updates trie immediately, defers DB write
      batchWriter.enqueue(query);

      // Invalidate cache entries for all prefixes of this query so the
      // updated count is visible on next /suggest call
      const normalized = query.toLowerCase();
      const invalidations: Promise<void>[] = [];
      for (let i = 1; i <= Math.min(normalized.length, 5); i++) {
        const prefix = normalized.slice(0, i);
        invalidations.push(redisRouter.del(`suggest:${prefix}:c`));
        invalidations.push(redisRouter.del(`suggest:${prefix}:t`));
      }
      await Promise.all(invalidations);

      return reply.send({ message: "Searched", query });
    }
  );
}
