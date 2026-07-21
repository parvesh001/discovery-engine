import Anthropic from '@anthropic-ai/sdk';
import { LlmRequestError, LlmTimeoutError } from './errors.js';

export type ClaudeMessage = { role: 'user' | 'assistant'; content: string };

export type ClaudeCallOptions = {
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function isTransientError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === undefined || error.status >= 500 || error.status === 429;
  }
  // Network errors, aborts, and anything else unrecognized are treated as
  // transient so a flaky connection still gets the one retry rule #3 requires.
  return true;
}

async function callOnce(client: Anthropic, opts: ClaudeCallOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await client.messages.create(
      {
        model: opts.model,
        system: opts.system,
        max_tokens: opts.maxTokens,
        messages: opts.messages,
      },
      { signal: controller.signal, maxRetries: 0 },
    );

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock) {
      throw new LlmRequestError('Claude response contained no text content block');
    }
    return textBlock.text;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmTimeoutError(`Claude call timed out after ${timeoutMs}ms (model=${opts.model})`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function toLlmRequestError(error: unknown): LlmRequestError {
  if (error instanceof LlmRequestError || error instanceof LlmTimeoutError) {
    return error as unknown as LlmRequestError;
  }
  return new LlmRequestError(error instanceof Error ? error.message : 'Unknown error calling Claude', error);
}

/**
 * Shared Claude wrapper (CLAUDE.md rule #1) — the only place `@anthropic-ai/sdk`
 * is imported anywhere in the backend. Owns timeout, one retry on transient
 * failure, and logging; never returns a fabricated value on failure.
 */
export async function callClaude(opts: ClaudeCallOptions): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const result = await callOnce(client, opts);
    console.log(`[llm] claude call succeeded model=${opts.model}`);
    return result;
  } catch (firstError) {
    console.error(`[llm] claude call failed (attempt 1) model=${opts.model}:`, firstError);

    if (!(firstError instanceof LlmTimeoutError) && !isTransientError(firstError)) {
      throw toLlmRequestError(firstError);
    }

    try {
      const result = await callOnce(client, opts);
      console.log(`[llm] claude call succeeded on retry model=${opts.model}`);
      return result;
    } catch (secondError) {
      console.error(`[llm] claude call failed (attempt 2, giving up) model=${opts.model}:`, secondError);
      if (secondError instanceof LlmTimeoutError) {
        throw secondError;
      }
      throw toLlmRequestError(secondError);
    }
  }
}
