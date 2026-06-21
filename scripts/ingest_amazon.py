#!/usr/bin/env python3
"""
Ingest Amazon Products dataset from Kaggle into typeahead.db.

Prerequisites:
    pip install kaggle pandas
    # Place your Kaggle API token at ~/.kaggle/kaggle.json
    # Get it from: https://www.kaggle.com/settings → Create New Token

Usage:
    python scripts/ingest_amazon.py

Downloads: asaniczka/amazon-products-dataset-2023-1-4m-products (~1.4M rows)
Column used: 'title' (product name) + 'reviews' or 'ratings' (popularity signal)
"""

import sqlite3
import os
import sys
import time
import zipfile
import glob

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "typeahead.db")
DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "kaggle_data")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

DATASET = "asaniczka/amazon-products-dataset-2023-1-4m-products"

def download_dataset():
    try:
        import kaggle
    except ImportError:
        print("ERROR: kaggle not installed. Run: pip install kaggle")
        print("       Also place your API token at ~/.kaggle/kaggle.json")
        sys.exit(1)

    print(f"Downloading dataset: {DATASET}")
    print("(~100MB, may take a minute...)")
    kaggle.api.authenticate()
    kaggle.api.dataset_download_files(DATASET, path=DOWNLOAD_DIR, unzip=False)
    print("  Download complete.")

    # Find the zip
    zips = glob.glob(os.path.join(DOWNLOAD_DIR, "*.zip"))
    if not zips:
        print("ERROR: No zip file found after download")
        sys.exit(1)
    zip_path = zips[0]
    print(f"  Extracting {zip_path}...")
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(DOWNLOAD_DIR)
    return DOWNLOAD_DIR

def find_csv(directory: str) -> str:
    csvs = glob.glob(os.path.join(directory, "*.csv"))
    if not csvs:
        print(f"ERROR: No CSV found in {directory}")
        sys.exit(1)
    return sorted(csvs)[0]

def main():
    t0 = time.time()

    try:
        import pandas as pd
    except ImportError:
        print("ERROR: pandas not installed. Run: pip install pandas")
        sys.exit(1)

    # Check if already downloaded
    existing_csvs = glob.glob(os.path.join(DOWNLOAD_DIR, "*.csv"))
    if existing_csvs:
        csv_path = sorted(existing_csvs)[0]
        print(f"Using existing CSV: {csv_path}")
    else:
        download_dataset()
        csv_path = find_csv(DOWNLOAD_DIR)

    print(f"Reading {csv_path}...")
    df = pd.read_csv(csv_path, low_memory=False)
    print(f"  Columns: {list(df.columns)}")
    print(f"  Shape: {df.shape}")

    # Determine count column — check several possible names
    count_col = None
    for candidate in ["reviews", "ratings", "rating_count", "no_of_ratings", "reviews_count"]:
        if candidate in df.columns:
            count_col = candidate
            break
    if count_col is None:
        print(f"WARNING: No count column found. Columns: {list(df.columns)}")
        print("Falling back to uniform count=1")
        df["_count"] = 1
        count_col = "_count"

    title_col = None
    for candidate in ["title", "product_name", "name", "Title"]:
        if candidate in df.columns:
            title_col = candidate
            break
    if title_col is None:
        print(f"ERROR: No title column found. Columns: {list(df.columns)}")
        sys.exit(1)

    print(f"Using columns: title='{title_col}', count='{count_col}'")

    # Process
    df = df[[title_col, count_col]].copy()
    df.columns = ["query", "count"]
    df = df.dropna(subset=["query"])
    df["query"] = df["query"].astype(str).str.lower().str.strip()
    df["query"] = df["query"].str.replace(r"\s+", " ", regex=True)

    # Convert count to numeric, fill NaN with 1
    df["count"] = pd.to_numeric(df["count"], errors="coerce").fillna(1).astype(int)
    df["count"] = df["count"].clip(lower=1)

    # Aggregate duplicates (same product title from multiple rows)
    df = df.groupby("query", as_index=False)["count"].sum()
    df = df[df["query"].str.len() >= 2]  # remove single-char titles
    df = df.sort_values("count", ascending=False)

    print(f"  {len(df):,} unique product titles after processing")
    print(f"  Top 5:")
    for _, row in df.head(5).iterrows():
        print(f"    '{row['query'][:60]}' → {row['count']:,}")

    rows = list(zip(df["query"], df["count"]))

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

    batch_size = 10_000
    for i in range(0, len(rows), batch_size):
        con.executemany(
            "INSERT OR REPLACE INTO queries (query, count) VALUES (?, ?)",
            rows[i : i + batch_size]
        )
        con.commit()
        print(f"  Wrote {min(i+batch_size, len(rows)):,}/{len(rows):,} rows...")

    check = con.execute("SELECT COUNT(*) FROM queries").fetchone()[0]
    con.close()

    print(f"\n✅ Done! {check:,} rows in {DB_PATH}")
    print(f"   Dataset: Amazon Products ({count_col} = popularity signal)")
    print(f"   Time: {time.time()-t0:.1f}s total")

if __name__ == "__main__":
    main()
