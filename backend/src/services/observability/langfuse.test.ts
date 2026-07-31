import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('langfuse observability module (no LANGFUSE keys configured)', () => {
  beforeEach(() => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', '');
    vi.stubEnv('LANGFUSE_SECRET_KEY', '');
    vi.resetModules();
  });

  it('startSearchTrace returns null instead of throwing', async () => {
    const { startSearchTrace } = await import('./langfuse.js');
    expect(startSearchTrace('a query')).toBeNull();
  });

  it('startIngestionTrace returns null instead of throwing', async () => {
    const { startIngestionTrace } = await import('./langfuse.js');
    expect(startIngestionTrace('listing-id')).toBeNull();
  });

  it('recordGeneration is a no-op when parent is null', async () => {
    const { recordGeneration } = await import('./langfuse.js');
    expect(() =>
      recordGeneration(null, {
        name: 'extraction',
        model: 'claude-haiku-4-5-20251001',
        input: 'input',
        output: 'output',
        usage: { inputTokens: 10, outputTokens: 5 },
        startTime: new Date(),
      }),
    ).not.toThrow();
  });

  it('recordSpan is a no-op when parent is null', async () => {
    const { recordSpan } = await import('./langfuse.js');
    expect(() =>
      recordSpan(null, { name: 'embedding', input: 'input', output: 'output', startTime: new Date() }),
    ).not.toThrow();
  });

  it('flushLangfuse resolves without throwing', async () => {
    const { flushLangfuse } = await import('./langfuse.js');
    await expect(flushLangfuse()).resolves.toBeUndefined();
  });
});
