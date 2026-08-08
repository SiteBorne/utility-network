import type { InjectedClock } from '../context';
import type { CacheInterface, CacheEntry, CacheKey, CachePolicy } from './interface';
import { createCacheKey, isExpired, DEFAULT_CACHE_POLICY } from './interface';

export class InMemoryCache implements CacheInterface {
  private store = new Map<string, CacheEntry>();
  private clock: InjectedClock;
  private policy: CachePolicy;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private accessOrder: string[] = [];

  constructor(clock: InjectedClock, policy: CachePolicy = DEFAULT_CACHE_POLICY) {
    this.clock = clock;
    this.policy = policy;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const now = this.clock.nowMs();
    if (isExpired(entry, now)) {
      this.store.delete(key);
      this.removeFromAccessOrder(key);
      this.misses++;
      return null;
    }

    entry.accessCount++;
    entry.lastAccessedAt = now;
    this.updateAccessOrder(key);
    this.hits++;

    return entry as CacheEntry<T>;
  }

  async set<T>(
    key: string,
    entry: Omit<CacheEntry<T>, 'storedAt' | 'accessCount' | 'lastAccessedAt'>
  ): Promise<void> {
    const now = this.clock.nowMs();

    if (this.store.size >= this.policy.maxSize && !this.store.has(key)) {
      this.evict();
    }

    const fullEntry: CacheEntry<T> = {
      ...entry,
      key,
      storedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
    } as CacheEntry<T>;

    this.store.set(key, fullEntry);
    this.updateAccessOrder(key);
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.store.delete(key);
    if (existed) {
      this.removeFromAccessOrder(key);
    }
    return existed;
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;

    const now = this.clock.nowMs();
    if (isExpired(entry, now)) {
      this.store.delete(key);
      this.removeFromAccessOrder(key);
      return false;
    }
    return true;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.accessOrder = [];
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  async getStats(): Promise<{ size: number; hits: number; misses: number; evictions: number }> {
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private evict(): void {
    if (this.accessOrder.length === 0) return;

    const keyToEvict = this.accessOrder[0];
    this.store.delete(keyToEvict);
    this.removeFromAccessOrder(keyToEvict);
    this.evictions++;
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index >= 0) {
      this.accessOrder.splice(index, 1);
    }
  }

  getPolicy(): CachePolicy {
    return { ...this.policy };
  }

  setPolicy(policy: Partial<CachePolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }
}

export function createCacheKeyFromParts(parts: CacheKey): string {
  return createCacheKey(parts);
}

export function createTestCache(): InMemoryCache {
  let currentTime = Date.now();
  const clock = {
    nowMs: () => currentTime,
    now: () => new Date(currentTime),
    setTimeout: (cb: () => void, delay: number) => setTimeout(cb, delay),
    clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
    advance: (ms: number) => {
      currentTime += ms;
    },
    getCurrentTime: () => currentTime,
    setTime: (ms: number) => {
      currentTime = ms;
    },
  };
  return new InMemoryCache(clock);
}
