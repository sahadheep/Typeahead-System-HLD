/**
 * Trending Score Module — Phase 6
 *
 * Problem: a query like "GameOfThrones" might have 2M historical searches
 * but near-zero recent activity. A suddenly popular query "WorldCup2026"
 * has 50k total but 10k in the last hour. Pure count-ranking buries it.
 *
 * Solution: blended score mixing long-term count (stability) with
 * exponentially-decayed recent activity (freshness).
 *
 *   score = α · log1p(totalCount) + β · recencyScore
 *   recencyScore = Σ bucket.count × exp(-λ × hoursAgo)
 *
 * Parameters (tunable):
 *   α = 0.7  — weight for log-scaled historical count
 *   β = 0.3  — weight for recency signal
 *   λ = 0.1  — decay constant (~10h half-life)
 *   window = 48 hours of buckets retained
 */

import { stmts } from "../db/sqlite";
import { Trie } from "../trie/trie";

const ALPHA = 0.7;
const BETA = 0.3;
const LAMBDA = 0.1; // decay rate per hour
const WINDOW_HOURS = 48;

export function computeScore(
  totalCount: number,
  hourlyBuckets: { hour: number; count: number }[],
  nowMs: number = Date.now()
): number {
  const nowHour = Math.floor(nowMs / 3_600_000);
  const cutoffHour = nowHour - WINDOW_HOURS;

  const recencyScore = hourlyBuckets
    .filter((b) => b.hour >= cutoffHour)
    .reduce((acc, b) => {
      const hoursAgo = nowHour - b.hour;
      return acc + b.count * Math.exp(-LAMBDA * hoursAgo);
    }, 0);

  return ALPHA * Math.log1p(totalCount) + BETA * recencyScore;
}

/**
 * Recompute trending scores for all queries in the trie that have
 * been active in the last WINDOW_HOURS hours, then update trie scores.
 *
 * Called on boot and periodically (every ~5 min) by the background interval.
 */
export function recomputeTrendingScores(trie: Trie): number {
  const nowMs = Date.now();
  const cutoffHour = Math.floor(nowMs / 3_600_000) - WINDOW_HOURS;

  // Get all queries that have recent bucket activity
  const activeQueries = stmts.getAllQueries.all();
  let updated = 0;

  for (const row of activeQueries) {
    const buckets = stmts.getTrendBuckets.all(row.query, cutoffHour);
    if (buckets.length === 0) {
      // No recent activity — score defaults to log of total count
      trie.updateScore(row.query, ALPHA * Math.log1p(row.count));
      continue;
    }
    const score = computeScore(row.count, buckets, nowMs);
    trie.updateScore(row.query, score);
    updated++;
  }

  return updated;
}

/**
 * Clean up old trend buckets outside the retention window.
 * Call once per hour.
 */
export function cleanOldBuckets(): void {
  const cutoffHour = Math.floor(Date.now() / 3_600_000) - WINDOW_HOURS;
  stmts.cleanOldTrendBuckets.run(cutoffHour);
}
