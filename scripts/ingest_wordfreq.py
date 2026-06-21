#!/usr/bin/env python3
"""
Ingest wordfreq corpus into typeahead.db
Usage: python scripts/ingest_wordfreq.py

Install: pip install wordfreq
Outputs: backend/data/typeahead.db with 150,000 rows
"""

import sqlite3
import os
import time

try:
    from wordfreq import top_n_list, word_frequency
except ImportError:
    print("ERROR: wordfreq not installed. Run: pip install wordfreq")
    raise SystemExit(1)

TARGET = 150_000
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "typeahead.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

print(f"Fetching top {TARGET:,} English words from wordfreq...")
t0 = time.time()
words = top_n_list("en", TARGET)
print(f"  Got {len(words):,} words in {time.time()-t0:.1f}s")

print("Computing counts (scaled frequency × 1B)...")
rows = []
for w in words:
    freq = word_frequency(w, "en")
    count = max(1, round(freq * 1_000_000_000))
    rows.append((w.lower().strip(), count))

# Remove duplicates, keep highest count
deduped = {}
for query, count in rows:
    if query and query not in deduped:
        deduped[query] = count
rows = list(deduped.items())
print(f"  {len(rows):,} unique queries after dedup")

print(f"Writing to {DB_PATH}...")
con = sqlite3.connect(DB_PATH)
con.execute("PRAGMA journal_mode=WAL")
con.execute("""
    CREATE TABLE IF NOT EXISTS queries (
        query TEXT PRIMARY KEY NOT NULL,
        count INTEGER NOT NULL DEFAULT 0
    )
""")
con.execute("""
    CREATE TABLE IF NOT EXISTS trend_buckets (
        query TEXT NOT NULL,
        hour  INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (query, hour)
    )
""")
con.execute("CREATE INDEX IF NOT EXISTS idx_queries_count ON queries(count DESC)")

con.execute("DELETE FROM queries")  # fresh ingest
con.executemany(
    "INSERT OR REPLACE INTO queries (query, count) VALUES (?, ?)", rows
)
con.commit()

count_check = con.execute("SELECT COUNT(*) FROM queries").fetchone()[0]
con.close()

print(f"\n✅ Done! {count_check:,} rows in {DB_PATH}")
print(f"   Dataset: wordfreq English corpus (scaled frequency scores)")
print(f"   Time: {time.time()-t0:.1f}s total")
