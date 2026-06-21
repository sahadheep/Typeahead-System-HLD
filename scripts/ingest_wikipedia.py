#!/usr/bin/env python3
"""
Ingest Wikipedia pageview dump into typeahead.db.

Usage:
    python scripts/ingest_wikipedia.py

Downloads a recent hourly dump (~100MB) automatically, or point to a local file:
    python scripts/ingest_wikipedia.py --file /path/to/pageviews-*.gz

Filters:
    - Only English desktop (domain == 'en') + optional mobile (en.m)
    - Strips titles with ':' (namespace pages like Special:, Talk:)
    - Strips underscores (replaces _ with space, as Wikipedia stores titles)
    - Minimum 2 page views to reduce junk
"""

import sqlite3
import gzip
import os
import sys
import argparse
import urllib.request
import time
from collections import defaultdict

DEFAULT_URL = "https://dumps.wikimedia.org/other/pageviews/2026/2026-06/pageviews-20260620-120000.gz"
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "typeahead.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--file", default=None, help="Path to local .gz pageview file")
    p.add_argument("--url", default=DEFAULT_URL, help="URL of the pageview dump")
    p.add_argument("--include-mobile", action="store_true", help="Also include en.m titles")
    p.add_argument("--min-views", type=int, default=2, help="Minimum page view threshold")
    return p.parse_args()

def download_file(url: str) -> str:
    local = os.path.join(os.path.dirname(__file__), "pageviews.gz")
    if os.path.exists(local):
        print(f"  Using cached file: {local}")
        return local
    print(f"  Downloading {url}")
    print("  (This may take a few minutes for ~100MB file...)")
    urllib.request.urlretrieve(url, local)
    return local

def process_dump(filepath: str, include_mobile: bool, min_views: int):
    counts: dict[str, int] = defaultdict(int)
    domains = {"en"} | ({"en.m"} if include_mobile else set())
    lines_read = 0

    with gzip.open(filepath, "rt", encoding="utf-8", errors="ignore") as f:
        for line in f:
            lines_read += 1
            if lines_read % 1_000_000 == 0:
                print(f"    {lines_read:,} lines read, {len(counts):,} unique titles so far...")

            parts = line.split(" ")
            if len(parts) < 3:
                continue
            domain, title, view_str = parts[0], parts[1], parts[2]
            if domain not in domains:
                continue
            if ":" in title:  # strip namespace pages
                continue
            try:
                views = int(view_str)
            except ValueError:
                continue
            if views < min_views:
                continue
            # Normalize: decode %XX, replace _ with space, lowercase
            try:
                clean = urllib.request.unquote(title).replace("_", " ").lower().strip()
            except Exception:
                continue
            if clean:
                counts[clean] += views

    return counts

def main():
    args = parse_args()
    t0 = time.time()

    filepath = args.file or download_file(args.url)
    print(f"Processing dump...")
    counts = process_dump(filepath, args.include_mobile, args.min_views)
    print(f"  {len(counts):,} unique titles found in {time.time()-t0:.1f}s")

    rows = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    print(f"  Top 5: {rows[:5]}")

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
    con.execute("DELETE FROM queries")
    con.executemany("INSERT OR REPLACE INTO queries (query, count) VALUES (?, ?)", rows)
    con.commit()

    check = con.execute("SELECT COUNT(*) FROM queries").fetchone()[0]
    con.close()

    print(f"\n✅ Done! {check:,} rows in {DB_PATH}")
    print(f"   Dataset: Wikipedia pageviews (en{' + en.m' if args.include_mobile else ''})")
    print(f"   Time: {time.time()-t0:.1f}s total")

if __name__ == "__main__":
    main()
