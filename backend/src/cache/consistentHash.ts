/**
 * Consistent Hashing Ring
 *
 * How it works:
 * - Every physical node gets `virtualNodes` (default 150) positions on a
 *   logical ring [0, 2^32).
 * - Each virtual node is hashed as "<nodeId>#<i>" to spread them evenly.
 * - getNode(key) hashes the key and does a clockwise binary-search lookup
 *   on the sorted ring, wrapping around to the first node if past the end.
 *
 * Why virtual nodes matter (viva answer):
 * - Without them, physical nodes get adjacent ring segments of wildly varying
 *   sizes — one node might own 40% of the key space, another 5%.
 * - With 150 virtual nodes per physical node, the law of large numbers drives
 *   each node's share toward 1/N of the ring.
 * - When you add or remove a node, only ~1/N of keys need to move — not all of them.
 */

export interface RingNode {
  id: string;
  port: number;
  host: string;
}

export class ConsistentHashRing {
  private ring: Map<number, RingNode> = new Map(); // hash → node
  private sortedHashes: number[] = [];
  private readonly virtualNodes: number;

  constructor(nodes: RingNode[], virtualNodes = 150) {
    this.virtualNodes = virtualNodes;
    for (const node of nodes) {
      this.addNode(node);
    }
  }

  addNode(node: RingNode): void {
    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${node.id}#${i}`;
      const hash = this.fnv1a(virtualKey);
      this.ring.set(hash, node);
    }
    this.rebuildSortedHashes();
  }

  removeNode(nodeId: string): void {
    for (let i = 0; i < this.virtualNodes; i++) {
      const virtualKey = `${nodeId}#${i}`;
      const hash = this.fnv1a(virtualKey);
      this.ring.delete(hash);
    }
    this.rebuildSortedHashes();
  }

  /**
   * Returns the node responsible for the given key.
   * Binary search to find the first hash >= key's hash (clockwise).
   * Wraps around to index 0 if past the last hash.
   */
  getNode(key: string): RingNode {
    if (this.sortedHashes.length === 0) {
      throw new Error("No nodes in ring");
    }

    const keyHash = this.fnv1a(key);
    let lo = 0;
    let hi = this.sortedHashes.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedHashes[mid]! < keyHash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Wrap around
    const idx = lo % this.sortedHashes.length;
    const hash = this.sortedHashes[idx]!;
    return this.ring.get(hash)!;
  }

  getNodeForDebug(key: string): { node: RingNode; ringPosition: number; keyHash: number } {
    const keyHash = this.fnv1a(key);
    const node = this.getNode(key);
    const ringPosition = this.fnv1a(`${node.id}#0`); // approx position
    return { node, ringPosition, keyHash };
  }

  getRingSize(): number {
    return this.sortedHashes.length;
  }

  private rebuildSortedHashes(): void {
    this.sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  /**
   * FNV-1a 32-bit hash — fast, good distribution, easy to explain.
   * https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
   */
  private fnv1a(str: string): number {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      // Multiply by FNV prime (32-bit), keep within 32-bit unsigned int
      hash = (hash * 16777619) >>> 0;
    }
    return hash;
  }
}
