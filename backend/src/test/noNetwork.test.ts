import { afterEach, describe, expect, it } from 'vitest';

// Verifies the setupFile guard (noNetwork.ts) is active: an unmocked `fetch` throws
// rather than reaching the network. The `beforeEach` in the setup file re-asserts the
// stub, so tests here don't need to restore it — but do it anyway to be explicit.
describe('noNetwork test guard', () => {
  const blocked = global.fetch;

  afterEach(() => {
    global.fetch = blocked;
  });

  it('throws on a string URL, naming it', () => {
    expect(() => global.fetch('https://api.voyageai.com/v1/embeddings')).toThrow(
      /Unmocked network call in test.*api\.voyageai\.com\/v1\/embeddings/s,
    );
  });

  it('throws on a URL object', () => {
    expect(() => global.fetch(new URL('https://example.com/x'))).toThrow(/Unmocked network call/);
  });

  it('lets a test install its own mock', async () => {
    global.fetch = (async () => new Response('ok')) as unknown as typeof fetch;
    await expect(global.fetch('https://example.com')).resolves.toBeInstanceOf(Response);
  });
});
