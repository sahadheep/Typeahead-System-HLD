/**
 * Trie data structure for O(prefix-length) autocomplete lookups.
 *
 * Design choices:
 * - Each node stores only its children Map; query data lives only at terminal nodes.
 *   This keeps RAM lower than "store queries at every ancestor node".
 * - getSuggestions does a DFS from the prefix node, collects all terminal queries,
 *   sorts by score (or count) descending, and returns the top N.
 * - The trie is loaded once at boot from SQLite. Subsequent insertions/updates
 *   happen in-memory; durability is handled by SQLite separately.
 *
 * Complexity:
 * - insert:        O(L)     where L = query length
 * - getSuggestions: O(L + D·log D) where D = #descendants (sort step)
 */

export interface QueryEntry {
  query: string;
  count: number;
  score: number; // trending score (defaults to count when trending is off)
}

export class TrieNode {
  children: Map<string, TrieNode> = new Map();
  // Terminal data — only set when a query ends at this node
  terminal: QueryEntry | null = null;
}

export class Trie {
  private root: TrieNode = new TrieNode();
  private totalInserted = 0;

  /**
   * Insert or update a query. If the query already exists, count is replaced
   * (not added) — use updateCount to add a delta.
   */
  insert(query: string, count: number, score?: number): void {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return;

    let node = this.root;
    for (const char of normalized) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char)!;
    }

    if (node.terminal === null) {
      this.totalInserted++;
    }
    node.terminal = {
      query: normalized,
      count,
      score: score ?? count,
    };
  }

  /**
   * Increment count for an existing query by delta (default 1).
   * Returns the updated entry, or null if query not in trie.
   */
  updateCount(query: string, delta = 1): QueryEntry | null {
    const normalized = query.toLowerCase().trim();
    let node = this.root;
    for (const char of normalized) {
      const next = node.children.get(char);
      if (!next) return null;
      node = next;
    }
    if (node.terminal === null) {
      // New query not in trie yet — insert it
      this.insert(normalized, delta);
      return node.terminal;
    }
    node.terminal.count += delta;
    node.terminal.score += delta;
    return node.terminal;
  }

  /**
   * Update the score of an existing query (used by trending module).
   */
  updateScore(query: string, score: number): void {
    const normalized = query.toLowerCase().trim();
    let node = this.root;
    for (const char of normalized) {
      const next = node.children.get(char);
      if (!next) return;
      node = next;
    }
    if (node.terminal) {
      node.terminal.score = score;
    }
  }

  /**
   * Walk to the prefix node, then DFS to collect all terminal descendants.
   * Returns top N sorted by score descending.
   */
  getSuggestions(prefix: string, topN = 10, useScore = false): QueryEntry[] {
    const normalized = prefix.toLowerCase().trim();

    if (!normalized) {
      // Return global top-N by score from root (expensive — only for empty prefix)
      const all = this.collectAll(this.root);
      return this.topN(all, topN, useScore);
    }

    // Walk to prefix node
    let node = this.root;
    for (const char of normalized) {
      const next = node.children.get(char);
      if (!next) return []; // no matches
      node = next;
    }

    const results = this.collectAll(node);
    return this.topN(results, topN, useScore);
  }

  /**
   * DFS from a given node, collecting all terminal entries.
   */
  private collectAll(node: TrieNode): QueryEntry[] {
    const results: QueryEntry[] = [];
    const stack: TrieNode[] = [node];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.terminal !== null) {
        results.push(current.terminal);
      }
      for (const child of current.children.values()) {
        stack.push(child);
      }
    }

    return results;
  }

  private topN(entries: QueryEntry[], n: number, useScore: boolean): QueryEntry[] {
    const sortKey = useScore ? "score" : "count";
    return entries
      .sort((a, b) => b[sortKey] - a[sortKey])
      .slice(0, n);
  }

  get size(): number {
    return this.totalInserted;
  }
}
