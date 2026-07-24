import { afterEach, describe, expect, it, vi } from 'vitest';

describe('reserveSlot', () => {
  const originalRateLimitEnv = process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE;

  afterEach(() => {
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = originalRateLimitEnv;
    vi.useRealTimers();
    vi.resetModules();
  });

  it('serializes concurrent callers, spacing them 60s/limit apart', async () => {
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = '3'; // 20s spacing
    vi.useFakeTimers();

    // Fresh module instance so module-level slot-queue state isn't shared with other tests.
    const { reserveSlot } = await import('./rateLimiter.js');

    const callTimestamps: number[] = [];
    const calls = Promise.all(
      [1, 2, 3].map(async () => {
        await reserveSlot();
        callTimestamps.push(Date.now());
      }),
    );
    await vi.runAllTimersAsync();
    await calls;

    expect(callTimestamps).toHaveLength(3);
    expect(callTimestamps[1]! - callTimestamps[0]!).toBeGreaterThanOrEqual(20_000);
    expect(callTimestamps[2]! - callTimestamps[1]!).toBeGreaterThanOrEqual(20_000);
  });

  it('lets callers proceed immediately when spaced further apart than the minimum interval', async () => {
    process.env.VOYAGE_MAX_REQUESTS_PER_MINUTE = '1000000';
    const { reserveSlot } = await import('./rateLimiter.js');

    const start = Date.now();
    await reserveSlot();
    await reserveSlot();
    expect(Date.now() - start).toBeLessThan(100);
  });
});
