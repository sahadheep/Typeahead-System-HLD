/**
 * Redis Router — wraps the ConsistentHashRing to route cache operations
 * across 3 Redis instances (ports 6379, 6380, 6381).
 *
 * Implements cache-aside pattern:
 *   get(key)           → check correct Redis node
 *   set(key, val, ttl) → write to correct Redis node
 *   del(key)           → delete from correct Redis node
 *
 * If a Redis node is unreachable, operations gracefully degrade (miss → trie).
 */

import Redis from "ioredis";
import { ConsistentHashRing, RingNode } from "./consistentHash";

export interface CacheStats {
  hits: number;
  misses: number;
  errors: number;
}

const NODES: RingNode[] = [
  { id: "redis-1", host: "127.0.0.1", port: 6379 },
  { id: "redis-2", host: "127.0.0.1", port: 6380 },
  { id: "redis-3", host: "127.0.0.1", port: 6381 },
];

const DEFAULT_TTL_SECONDS = 60;

export class RedisRouter {
  private ring: ConsistentHashRing;
  private clients: Map<string, Redis>;
  private stats: CacheStats = { hits: 0, misses: 0, errors: 0 };
  private available = false;

  constructor(virtualNodes = 150) {
    this.ring = new ConsistentHashRing(NODES, virtualNodes);
    this.clients = new Map();

    for (const node of NODES) {
      const client = new Redis({
        host: node.host,
        port: node.port,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: 1000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // don't retry — fail fast, degrade gracefully
      });

      client.on("error", () => {
        // silently absorb — we handle errors at call site
      });

      this.clients.set(node.id, client);
    }
  }

  async connect(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.clients.values()).map((c) => c.connect())
    );
    const connected = results.filter((r) => r.status === "fulfilled").length;
    this.available = connected > 0;
    console.log(`Redis: ${connected}/${NODES.length} nodes connected`);
  }

  async disconnect(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.quit().catch(() => {});
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.available) return null;
    const node = this.ring.getNode(key);
    const client = this.clients.get(node.id);
    if (!client) return null;

    try {
      const val = await client.get(key);
      if (val !== null) {
        this.stats.hits++;
      } else {
        this.stats.misses++;
      }
      return val;
    } catch {
      this.stats.errors++;
      this.stats.misses++;
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    if (!this.available) return;
    const node = this.ring.getNode(key);
    const client = this.clients.get(node.id);
    if (!client) return;

    try {
      await client.set(key, value, "EX", ttlSeconds);
    } catch {
      this.stats.errors++;
    }
  }

  async del(key: string): Promise<void> {
    if (!this.available) return;
    const node = this.ring.getNode(key);
    const client = this.clients.get(node.id);
    if (!client) return;

    try {
      await client.del(key);
    } catch {
      this.stats.errors++;
    }
  }

  /** For /cache/debug endpoint */
  debugNode(key: string): {
    node: RingNode;
    ringPosition: number;
    keyHash: number;
    ringSize: number;
  } {
    const info = this.ring.getNodeForDebug(key);
    return { ...info, ringSize: this.ring.getRingSize() };
  }

  /** Check if a key is currently cached (for debug endpoint) */
  async peek(key: string): Promise<string | null> {
    if (!this.available) return null;
    const node = this.ring.getNode(key);
    const client = this.clients.get(node.id);
    if (!client) return null;
    try {
      return await client.get(key);
    } catch {
      return null;
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  isAvailable(): boolean {
    return this.available;
  }
}

// Singleton — shared across all route handlers
export const redisRouter = new RedisRouter();
