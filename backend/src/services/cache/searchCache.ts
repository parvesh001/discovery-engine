import type { Redis } from 'ioredis';
import type { SearchResponse } from '../search/orchestrateSearch.js';
import type { QueryIntent } from '../search/queryUnderstanding.js';

const CACHE_KEY_PREFIX = 'search:v1:';
const CACHE_TTL_SECONDS = 600; // 10 minutes (spec 10, requirement 3)

/**
 * Cached alongside the response so a cache-hit search_logs row can carry an accurate
 * `extracted_intent` (the intent from the run that originally populated this entry)
 * instead of a fabricated placeholder — same "no silent failures / honest logs" spirit
 * as the rest of this pipeline's observability.
 */
export type CachedSearchEntry = { response: SearchResponse; intent: QueryIntent };

/**
 * Trim/lowercase/collapse-whitespace only — see the spec 10 Post-Merge Amendment
 * (cache key scope) for why this, not "query + filter combination" as literally worded,
 * is the correct key: filters don't exist as an independent input at the point this cache
 * must be checked (before understandQuery runs) to also save the LLM call on a hit.
 */
export function normalizeQuery(rawQuery: string): string {
  return rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildCacheKey(rawQuery: string): string {
  return `${CACHE_KEY_PREFIX}${normalizeQuery(rawQuery)}`;
}

/**
 * Never throws — a Redis failure is logged and treated as a miss, so caching can never
 * break search (same graceful-degradation spirit as the rest of the pipeline, CLAUDE.md
 * rule #3's "no LLM call can hard-crash a request" extended to this new dependency).
 */
export async function getCachedSearch(redis: Redis, rawQuery: string): Promise<CachedSearchEntry | null> {
  const key = buildCacheKey(rawQuery);
  try {
    const raw = await redis.get(key);
    if (raw === null) {
      console.log(`[cache] miss query=${JSON.stringify(rawQuery)}`);
      return null;
    }
    console.log(`[cache] hit query=${JSON.stringify(rawQuery)}`);
    return JSON.parse(raw) as CachedSearchEntry;
  } catch (error) {
    console.error('[cache] getCachedSearch failed, treating as miss:', error);
    return null;
  }
}

export async function setCachedSearch(redis: Redis, rawQuery: string, entry: CachedSearchEntry): Promise<void> {
  const key = buildCacheKey(rawQuery);
  try {
    await redis.set(key, JSON.stringify(entry), 'EX', CACHE_TTL_SECONDS);
  } catch (error) {
    console.error('[cache] setCachedSearch failed:', error);
  }
}
