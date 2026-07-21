import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMock, FakeAPIError } = vi.hoisted(() => {
  class FakeAPIError extends Error {
    status?: number;
    constructor(status: number | undefined, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { createMock: vi.fn(), FakeAPIError };
});

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: (...args: unknown[]) => createMock(...args) };
    static APIError = FakeAPIError;
  }
  return { default: Anthropic };
});

import { callClaude } from './client.js';
import { LlmRequestError, LlmTimeoutError } from './errors.js';

const baseOptions = {
  model: 'claude-haiku-4-5-20251001',
  system: 'sys',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 100,
};

describe('callClaude', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('returns the text content on success', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: 'hello' }] });

    const result = await callClaude(baseOptions);

    expect(result).toBe('hello');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on a transient (5xx) APIError and succeeds', async () => {
    createMock
      .mockRejectedValueOnce(new FakeAPIError(500, 'server error'))
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    const result = await callClaude(baseOptions);

    expect(result).toBe('ok');
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on a 429 APIError and succeeds', async () => {
    createMock
      .mockRejectedValueOnce(new FakeAPIError(429, 'rate limited'))
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    const result = await callClaude(baseOptions);

    expect(result).toBe('ok');
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed LlmRequestError after two failed attempts on transient errors', async () => {
    createMock.mockRejectedValue(new FakeAPIError(500, 'server error'));

    await expect(callClaude(baseOptions)).rejects.toBeInstanceOf(LlmRequestError);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a non-transient 4xx APIError', async () => {
    createMock.mockRejectedValueOnce(new FakeAPIError(400, 'bad request'));

    await expect(callClaude(baseOptions)).rejects.toBeInstanceOf(LlmRequestError);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('throws a typed LlmTimeoutError when the call exceeds timeoutMs, after one retry', async () => {
    createMock.mockImplementation((_params: unknown, options: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    await expect(callClaude({ ...baseOptions, timeoutMs: 10 })).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('throws LlmRequestError when the response has no text content block', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'tool_use' }] });

    await expect(callClaude(baseOptions)).rejects.toBeInstanceOf(LlmRequestError);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
