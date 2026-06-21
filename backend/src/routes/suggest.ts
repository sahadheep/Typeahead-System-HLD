/**
 * GET /suggest?q=<prefix>&mode=trending
 *
 * Cache-aside flow:
 *  1. Normalize prefix (lowercase, trim)
 *  2. Build cache key:  "suggest:<prefix>:<mode>"
 *  3. Route to correct Redis node via consistent-hash ring
 *  4. On HIT → return cached JSON
 *  5. On MISS → query trie → write to cache with TTL → return
 *
 * Returns: { suggestions: [{ query, count, score }], meta: { cacheHit, node, latencyMs } }
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Trie } from "../trie/trie";
import { redisRouter } from "../cache/redisRouter";

interface SuggestQuery {
  q?: string;
  mode?: "trending" | "count";
  limit?: string;
}

export async function suggestRoute(
  fastify: FastifyInstance,
  trie: Trie
): Promise<void> {
  fastify.get<{ Querystring: SuggestQuery }>(
    "/suggest",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            mode: { type: "string", enum: ["trending", "count"] },
            limit: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: true,
                  properties: {
                    query: { type: "string" },
                    count: { type: "number" },
                    score: { type: "number" },
                  },
                },
              },
              meta: {
                type: "object",
                additionalProperties: true,
                properties: {
                  cacheHit: { type: "boolean" },
                  node: { type: "string" },
                  port: { type: "number" },
                  latencyMs: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: SuggestQuery }>,
      reply: FastifyReply
    ) => {
      const start = Date.now();
      const raw = request.query.q ?? "";
      const prefix = raw.toLowerCase().trim();
      const useScore = request.query.mode === "trending";
      const limit = Math.min(parseInt(request.query.limit ?? "10", 10), 50);

      const cacheKey = `suggest:${prefix}:${useScore ? "t" : "c"}`;

      // ── Step 1: Check cache ──────────────────────────────────────────────
      const cached = await redisRouter.get(cacheKey);
      const latencyMs = Date.now() - start;

      if (cached !== null) {
        const nodeInfo = redisRouter.debugNode(cacheKey);
        return reply.send({
          suggestions: JSON.parse(cached),
          meta: {
            cacheHit: true,
            node: nodeInfo.node.id,
            port: nodeInfo.node.port,
            latencyMs,
          },
        });
      }

      // ── Step 2: Trie lookup ──────────────────────────────────────────────
      const suggestions = trie.getSuggestions(prefix, limit, useScore);

      // ── Step 3: Write to cache ───────────────────────────────────────────
      await redisRouter.set(cacheKey, JSON.stringify(suggestions));

      const nodeInfo = redisRouter.debugNode(cacheKey);
      const totalLatencyMs = Date.now() - start;

      return reply.send({
        suggestions,
        meta: {
          cacheHit: false,
          node: nodeInfo.node.id,
          port: nodeInfo.node.port,
          latencyMs: totalLatencyMs,
        },
      });
    }
  );
}
