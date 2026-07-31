import Anthropic from '@anthropic-ai/sdk';
import { LlmRequestError, LlmTimeoutError } from './errors.js';
import { recordGeneration, type LangfuseParent } from '../observability/langfuse.js';

export type ClaudeMessage = { role: 'user' | 'assistant'; content: string };

export type ClaudeCallOptions = {
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens: number;
  timeoutMs?: number;
  /** Langfuse generation name, e.g. 'extraction' | 'query_understanding' (spec 09). */
  stage: string;
  langfuseParent?: LangfuseParent | null;
};

export type ClaudeUsage = { inputTokens: number; outputTokens: number };

export type ClaudeCallResult = { text: string; usage: ClaudeUsage };

const DEFAULT_TIMEOUT_MS = 15_000;

function isTransientError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === undefined || error.status >= 500 || error.status === 429;
  }
  // Network errors, aborts, and anything else unrecognized are treated as
  // transient so a flaky connection still gets the one retry rule #3 requires.
  return true;
}

async function callOnce(client: Anthropic, opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
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
    return {
      text: textBlock.text,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
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

function traceSuccess(opts: ClaudeCallOptions, startTime: Date, result: ClaudeCallResult): void {
  recordGeneration(opts.langfuseParent ?? null, {
    name: opts.stage,
    model: opts.model,
    input: { system: opts.system, messages: opts.messages },
    output: result.text,
    usage: result.usage,
    startTime,
  });
}

/**
 * Shared Claude wrapper (CLAUDE.md rule #1) — the only place `@anthropic-ai/sdk`
 * is imported anywhere in the backend. Owns timeout, one retry on transient
 * failure, and logging; never returns a fabricated value on failure. Also owns
 * token-usage capture and Langfuse generation tracing (spec 09), so every call
 * site gets both automatically.
 */
export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const firstAttemptStart = new Date();
  try {
    const result = await callOnce(client, opts);
    console.log(`[llm] claude call succeeded model=${opts.model}`);
    traceSuccess(opts, firstAttemptStart, result);
    return result;
  } catch (firstError) {
    console.error(`[llm] claude call failed (attempt 1) model=${opts.model}:`, firstError);

    if (!(firstError instanceof LlmTimeoutError) && !isTransientError(firstError)) {
      throw toLlmRequestError(firstError);
    }

    const retryStart = new Date();
    try {
      const result = await callOnce(client, opts);
      console.log(`[llm] claude call succeeded on retry model=${opts.model}`);
      traceSuccess(opts, retryStart, result);
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
