/**
 * GET /metrics
 *
 * Returns system-level observability data for the viva:
 * - p95 latency on /suggest (rolling last 1000 requests)
 * - cache hit rate
 * - DB read / write counts
 * - batch writer queue state
 * - trie size
 */

import { FastifyInstance } from "fastify";
import { redisRouter } from "../cache/redisRouter";
import { BatchWriter } from "../workers/batchWriter";
import { Trie } from "../trie/trie";
import { stmts } from "../db/sqlite";

// Rolling window for p95 calculation
const LATENCY_WINDOW = 1000;
const latencies: number[] = [];

export function recordLatency(ms: number): void {
  latencies.push(ms);
  if (latencies.length > LATENCY_WINDOW) {
    latencies.shift();
  }
}

function computeP95(): number | null {
  if (latencies.length === 0) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[idx] ?? null;
}

let dbReadCount = 0;
let dbWriteCount = 0;
let totalSuggestRequests = 0;

export function incDbRead(): void { dbReadCount++; }
export function incDbWrite(): void { dbWriteCount++; }
export function incSuggestRequest(): void { totalSuggestRequests++; }

export async function metricsRoute(
  fastify: FastifyInstance,
  batchWriter: BatchWriter,
  trie: Trie
): Promise<void> {
  fastify.get("/metrics", async (_request, reply) => {
    const cacheStats = redisRouter.getStats();
    const batchMetrics = batchWriter.getMetrics();
    const totalCacheRequests = cacheStats.hits + cacheStats.misses;
    const hitRate =
      totalCacheRequests > 0
        ? ((cacheStats.hits / totalCacheRequests) * 100).toFixed(1) + "%"
        : "N/A";

    const dbInfo = stmts.getQueryCount.get();

    return reply.send({
      suggest: {
        totalRequests: totalSuggestRequests,
        p95LatencyMs: computeP95(),
        latencySampleSize: latencies.length,
      },
      cache: {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        errors: cacheStats.errors,
        hitRate,
        redisAvailable: redisRouter.isAvailable(),
      },
      database: {
        queryCount: dbInfo?.count ?? 0,
        readCount: dbReadCount,
        writeCount: dbWriteCount,
      },
      batchWriter: batchMetrics,
      trie: {
        loadedQueries: trie.size,
      },
    });
  });
}
