import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { getCachedSearch, setCachedSearch, normalizeQuery, type CachedSearchEntry } from './searchCache.js';

function makeRedis(getResult: string | null = null) {
  return {
    get: vi.fn().mockResolvedValue(getResult),
    set: vi.fn().mockResolvedValue('OK'),
  } as unknown as Redis;
}

const entry = { response: {}, intent: {} } as unknown as CachedSearchEntry;

describe('searchCache key scoping (spec 12)', () => {
  it('normalizeQuery trims, lowercases, and collapses whitespace', () => {
    expect(normalizeQuery('  Pet   Friendly Cabin  ')).toBe('pet friendly cabin');
  });

  it('an unscoped read/write uses the pre-Phase-11 key format', async () => {
    const redis = makeRedis();
    await getCachedSearch(redis, 'Beach Villa');
    await setCachedSearch(redis, 'Beach Villa', entry);

    expect(vi.mocked(redis.get).mock.calls[0]?.[0]).toBe('search:v1:beach villa');
    expect(vi.mocked(redis.set).mock.calls[0]?.[0]).toBe('search:v1:beach villa');
  });

  it('a destination namespaces the key so scoped and global never collide', async () => {
    const redis = makeRedis();
    await getCachedSearch(redis, 'Beach Villa', 'goa');
    await setCachedSearch(redis, 'Beach Villa', entry, 'goa');

    expect(vi.mocked(redis.get).mock.calls[0]?.[0]).toBe('search:v1:goa:beach villa');
    expect(vi.mocked(redis.set).mock.calls[0]?.[0]).toBe('search:v1:goa:beach villa');
  });

  it('two destinations produce distinct keys for the same query text', async () => {
    const redis = makeRedis();
    await getCachedSearch(redis, 'villa', 'goa');
    await getCachedSearch(redis, 'villa', 'manali');

    const keys = vi.mocked(redis.get).mock.calls.map((c) => c[0]);
    expect(new Set(keys).size).toBe(2);
  });

  it('a Redis failure is swallowed and treated as a miss', async () => {
    const redis = { get: vi.fn().mockRejectedValue(new Error('down')), set: vi.fn() } as unknown as Redis;
    await expect(getCachedSearch(redis, 'villa', 'goa')).resolves.toBeNull();
  });
});
