/**
 * Typeahead Backend — Main Entry Point
 *
 * Boot sequence:
 *  1. Open SQLite (creates DB + tables if first run)
 *  2. Load all queries into the Trie (~2-5s for 150k rows)
 *  3. Recompute trending scores from DB buckets
 *  4. Connect to Redis (degrades gracefully if unavailable)
 *  5. Start BatchWriter flush interval
 *  6. Register routes + start Fastify
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { Trie } from "./trie/trie";
import { stmts } from "./db/sqlite";
import { redisRouter } from "./cache/redisRouter";
import { BatchWriter } from "./workers/batchWriter";
import { recomputeTrendingScores, cleanOldBuckets } from "./trending/trendingScore";
import { suggestRoute } from "./routes/suggest";
import { searchRoute } from "./routes/search";
import { cacheDebugRoute } from "./routes/cacheDebug";
import { metricsRoute, recordLatency, incSuggestRequest } from "./routes/metrics";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function bootstrap() {
  const fastify = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss" },
      },
    },
  });

  // ── CORS ─────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: ["http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST", "OPTIONS"],
  });

  // ── Phase 1: Load Trie from SQLite ────────────────────────────────────────
  console.log("⏳ Loading trie from SQLite...");
  const trieLoadStart = Date.now();
  const trie = new Trie();

  const rows = stmts.getAllQueries.all();
  for (const row of rows) {
    trie.insert(row.query, row.count);
  }
  console.log(
    `✅ Trie loaded: ${trie.size.toLocaleString()} queries in ${Date.now() - trieLoadStart}ms`
  );

  // ── Phase 6: Compute initial trending scores ──────────────────────────────
  console.log("⏳ Computing trending scores...");
  const trendUpdated = recomputeTrendingScores(trie);
  console.log(`✅ Trending scores computed for ${trendUpdated} active queries`);

  // ── Phase 4: Connect Redis ────────────────────────────────────────────────
  await redisRouter.connect();

  // ── Phase 5: Start BatchWriter ────────────────────────────────────────────
  const batchWriter = new BatchWriter(trie, 5000, 200);
  batchWriter.start();

  // ── Periodic jobs ─────────────────────────────────────────────────────────
  // Re-score trending every 5 minutes
  setInterval(() => {
    const n = recomputeTrendingScores(trie);
    console.log(`[Trending] Rescored ${n} queries`);
  }, 5 * 60 * 1000);

  // Clean old trend buckets every hour
  setInterval(() => {
    cleanOldBuckets();
    console.log("[Trending] Old buckets cleaned");
  }, 60 * 60 * 1000);

  // ── Latency tracking hook ─────────────────────────────────────────────────
  fastify.addHook("onResponse", (request, reply, done) => {
    if (request.routerPath === "/suggest") {
      const latency = reply.getResponseTime();
      recordLatency(latency);
      incSuggestRequest();
    }
    done();
  });

  // ── Register Routes ───────────────────────────────────────────────────────
  await suggestRoute(fastify, trie);
  await searchRoute(fastify, batchWriter);
  await cacheDebugRoute(fastify);
  await metricsRoute(fastify, batchWriter, trie);

  // Health check
  fastify.get("/health", async () => ({
    status: "ok",
    trieSize: trie.size,
    redisAvailable: redisRouter.isAvailable(),
    uptime: process.uptime(),
  }));

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] Graceful shutdown...`);
    await batchWriter.stop();
    await redisRouter.disconnect();
    await fastify.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ── Start Server ──────────────────────────────────────────────────────────
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`🚀 Typeahead server running at http://localhost:${PORT}`);
  console.log(`   /suggest?q=<prefix>       — autocomplete`);
  console.log(`   /cache/debug?prefix=<x>   — hash ring debug`);
  console.log(`   /metrics                  — observability`);
  console.log(`   /health                   — health check`);
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
