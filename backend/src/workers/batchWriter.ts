/**
 * BatchWriter — Phase 5
 *
 * Problem: calling SQLite on every POST /search is fine for low traffic,
 * but under load it creates write contention (SQLite is single-writer).
 *
 * Solution:
 * - Maintain an in-memory Map<query, accumulatedDelta>
 * - Flush to SQLite in a single transaction every `intervalMs` OR when
 *   the queue hits `maxQueueSize` events
 * - One SQL write per unique query per flush (not one per event)
 *
 * Crash behaviour (documented in README):
 * - Any counts in `queue` that haven't been flushed yet are LOST on crash.
 * - Mitigation options for production: persist queue to a Redis list (durable
 *   if Redis has AOF/RDB), flush more frequently, or accept eventual
 *   consistency as assignment-scope trade-off.
 */

import { batchFlushTx, stmts } from "../db/sqlite";
import { Trie } from "../trie/trie";

interface FlushMetrics {
  totalFlushes: number;
  totalWritten: number;
  lastFlushAt: number | null;
}

export class BatchWriter {
  private queue: Map<string, number> = new Map(); // query → pending delta
  private trie: Trie;
  private intervalMs: number;
  private maxQueueSize: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private metrics: FlushMetrics = {
    totalFlushes: 0,
    totalWritten: 0,
    lastFlushAt: null,
  };

  constructor(trie: Trie, intervalMs = 5000, maxQueueSize = 200) {
    this.trie = trie;
    this.intervalMs = intervalMs;
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Enqueue a search event.
   * - Updates the trie immediately (so /suggest reflects recent activity at once)
   * - Accumulates the DB write for the next flush
   */
  enqueue(query: string): void {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return;

    // Immediate trie update for fresh suggestions
    this.trie.updateCount(normalized, 1);

    // Accumulate DB write
    const current = this.queue.get(normalized) ?? 0;
    this.queue.set(normalized, current + 1);

    // Also update trend bucket
    this.updateTrendBucket(normalized);

    // Trigger flush if queue is large enough
    if (this.queue.size >= this.maxQueueSize) {
      void this.flush();
    }
  }

  private updateTrendBucket(query: string): void {
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    try {
      stmts.upsertTrendBucket.run(query, hourBucket, 1);
    } catch {
      // Non-critical — don't let trend errors break the write path
    }
  }

  async flush(): Promise<void> {
    if (this.queue.size === 0) return;

    // Snapshot and clear queue atomically (JS is single-threaded — safe)
    const snapshot = new Map(this.queue);
    this.queue.clear();

    try {
      batchFlushTx(snapshot);
      this.metrics.totalFlushes++;
      this.metrics.totalWritten += snapshot.size;
      this.metrics.lastFlushAt = Date.now();

      console.log(
        `[BatchWriter] Flushed ${snapshot.size} unique queries (${[...snapshot.values()].reduce((a, b) => a + b, 0)} total events)`
      );
    } catch (err) {
      // If flush fails, re-merge back into queue so data isn't lost this cycle
      for (const [q, delta] of snapshot) {
        const existing = this.queue.get(q) ?? 0;
        this.queue.set(q, existing + delta);
      }
      console.error("[BatchWriter] Flush failed, re-queued:", err);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.intervalMs);
    console.log(`[BatchWriter] Started — flushing every ${this.intervalMs}ms`);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush(); // final flush on shutdown
    console.log("[BatchWriter] Stopped and final flush complete.");
  }

  getMetrics() {
    return {
      ...this.metrics,
      pendingQueueSize: this.queue.size,
      pendingEvents: [...this.queue.values()].reduce((a, b) => a + b, 0),
    };
  }
}
