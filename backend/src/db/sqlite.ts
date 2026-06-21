import Database, { type Database as BetterDB } from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.resolve(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "typeahead.db");

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db: BetterDB = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -64000"); // 64MB cache

// Create tables on first run
db.exec(`
  CREATE TABLE IF NOT EXISTS queries (
    query TEXT PRIMARY KEY NOT NULL,
    count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trend_buckets (
    query TEXT NOT NULL,
    hour  INTEGER NOT NULL,   -- Unix epoch truncated to hour (ms / 3600000)
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (query, hour)
  );

  CREATE INDEX IF NOT EXISTS idx_queries_count ON queries(count DESC);
  CREATE INDEX IF NOT EXISTS idx_trend_query   ON trend_buckets(query);
  CREATE INDEX IF NOT EXISTS idx_trend_hour    ON trend_buckets(hour);
`);

// Prepared statements (reused across requests for performance)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stmts: Record<string, any> = {
  getAllQueries: db.prepare<[], { query: string; count: number }>(
    "SELECT query, count FROM queries ORDER BY count DESC"
  ),

  getQuery: db.prepare<[string], { query: string; count: number }>(
    "SELECT query, count FROM queries WHERE query = ?"
  ),

  upsertQuery: db.prepare<[string, number]>(
    "INSERT INTO queries (query, count) VALUES (?, ?) ON CONFLICT(query) DO UPDATE SET count = count + excluded.count"
  ),

  incrementQuery: db.prepare<[string]>(
    "INSERT INTO queries (query, count) VALUES (?, 1) ON CONFLICT(query) DO UPDATE SET count = count + 1"
  ),

  batchIncrement: db.prepare<[string, number]>(
    "INSERT INTO queries (query, count) VALUES (?, ?) ON CONFLICT(query) DO UPDATE SET count = count + excluded.count"
  ),

  upsertTrendBucket: db.prepare<[string, number, number]>(
    "INSERT INTO trend_buckets (query, hour, count) VALUES (?, ?, ?) ON CONFLICT(query, hour) DO UPDATE SET count = count + excluded.count"
  ),

  getTrendBuckets: db.prepare<[string, number], { hour: number; count: number }>(
    "SELECT hour, count FROM trend_buckets WHERE query = ? AND hour >= ? ORDER BY hour ASC"
  ),

  cleanOldTrendBuckets: db.prepare<[number]>(
    "DELETE FROM trend_buckets WHERE hour < ?"
  ),

  getTotalCount: db.prepare<[], { total: number }>(
    "SELECT SUM(count) as total FROM queries"
  ),

  getQueryCount: db.prepare<[], { count: number }>(
    "SELECT COUNT(*) as count FROM queries"
  ),
};

// Batch flush transaction — increments multiple queries atomically
// Wrapped in a regular function to avoid exposing BetterSqlite3.Transaction type in exports
const _batchFlushTxInner = db.transaction((increments: Map<string, number>) => {
  for (const [query, delta] of increments) {
    stmts.batchIncrement.run(query, delta);
  }
});
export function batchFlushTx(increments: Map<string, number>): void {
  _batchFlushTxInner(increments);
}

export default db;
