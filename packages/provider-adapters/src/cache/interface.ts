import type { SourceObservation, CacheStatus, FreshnessStatus, AdapterResultClass } from '../types';

export interface CacheKey {
  providerId: string;
  capability: string;
  canonicalInput: string;
  fieldSet?: string;
  sourcePolicyVersion: string;
  adapterVersion: string;
  normalizationVersion: string;
}

export function createCacheKey(key: CacheKey): string {
  const parts = [
    key.providerId,
    key.capability,
    key.canonicalInput,
    key.fieldSet || '',
    key.sourcePolicyVersion,
    key.adapterVersion,
    key.normalizationVersion,
  ];
  return parts.join('|');
}

export interface CacheEntry<T = unknown> {
  key: string;
  resultClass: AdapterResultClass;
  observations?: SourceObservation[];
  error?: { code: string; message: string; details?: unknown; retryAfterMs?: number };
  storedAt: number;
  expiresAt: number;
  negativeExpiresAt?: number;
  contentHash?: string;
  accessCount: number;
  lastAccessedAt: number;
  // Type parameter used for type safety in CacheInterface methods
  _type?: T;
}

export interface CacheInterface {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(
    key: string,
    entry: Omit<CacheEntry<T>, 'storedAt' | 'accessCount' | 'lastAccessedAt'>
  ): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  getStats(): Promise<{ size: number; hits: number; misses: number; evictions: number }>;
}

export interface CachePolicy {
  ttlMs: number;
  negativeTtlMs: number;
  maxSize: number;
  evictionPolicy: 'lru' | 'lfu' | 'fifo';
}

export const DEFAULT_CACHE_POLICY: CachePolicy = {
  ttlMs: 24 * 60 * 60 * 1000,
  negativeTtlMs: 60 * 60 * 1000,
  maxSize: 10000,
  evictionPolicy: 'lru',
};

export function isExpired(entry: CacheEntry, now: number): boolean {
  return now >= entry.expiresAt;
}

export function isNegativeExpired(entry: CacheEntry, now: number): boolean {
  if (!entry.negativeExpiresAt) return true;
  return now >= entry.negativeExpiresAt;
}

export function getCacheStatus(entry: CacheEntry, now: number): CacheStatus {
  if (now >= entry.expiresAt) return 'stale';
  if (entry.negativeExpiresAt && now >= entry.negativeExpiresAt) return 'stale';
  return 'hit';
}

export function getFreshnessStatus(entry: CacheEntry, now: number): FreshnessStatus {
  if (now >= entry.expiresAt) return 'stale';
  return 'fresh';
}
