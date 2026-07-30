import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractAttributes, ExtractionError } from './extraction.js';

const callClaudeMock = vi.fn();
vi.mock('../llm/client.js', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
}));

const USAGE = { inputTokens: 10, outputTokens: 5 };

function claudeResult(text: string): { text: string; usage: typeof USAGE } {
  return { text, usage: USAGE };
}

describe('extractAttributes', () => {
  beforeEach(() => {
    callClaudeMock.mockReset();
  });

  it('returns parsed attributes and usage on a valid first response', async () => {
    callClaudeMock.mockResolvedValueOnce(
      claudeResult(
        JSON.stringify({
          property_type: 'cabin',
          pet_friendly: true,
          view_type: 'mountain view',
          amenities: ['hot tub', 'fireplace'],
          bedrooms_mentioned: 2,
        }),
      ),
    );

    const result = await extractAttributes('A cozy two-bedroom cabin with mountain views and a hot tub.');

    expect(result).toEqual({
      attributes: {
        property_type: 'cabin',
        pet_friendly: true,
        view_type: 'mountain view',
        amenities: ['hot tub', 'fireplace'],
        bedrooms_mentioned: 2,
      },
      usage: USAGE,
    });
    expect(callClaudeMock).toHaveBeenCalledTimes(1);
  });

  it('strips markdown code fences before parsing', async () => {
    callClaudeMock.mockResolvedValueOnce(
      claudeResult(
        '```json\n' +
          JSON.stringify({
            property_type: 'studio',
            pet_friendly: null,
            view_type: null,
            amenities: [],
            bedrooms_mentioned: null,
          }) +
          '\n```',
      ),
    );

    const result = await extractAttributes('Simple studio.');
    expect(result.attributes.property_type).toBe('studio');
  });

  it('retries once with an error-correction prompt on malformed JSON, then succeeds', async () => {
    callClaudeMock.mockResolvedValueOnce(claudeResult('not json'));
    callClaudeMock.mockResolvedValueOnce(
      claudeResult(
        JSON.stringify({
          property_type: 'loft',
          pet_friendly: null,
          view_type: null,
          amenities: [],
          bedrooms_mentioned: null,
        }),
      ),
    );

    const result = await extractAttributes('An industrial loft.');

    expect(result.attributes.property_type).toBe('loft');
    expect(callClaudeMock).toHaveBeenCalledTimes(2);

    const secondCallArgs = callClaudeMock.mock.calls[1]?.[0];
    expect(JSON.stringify(secondCallArgs)).toContain('not json');
  });

  it('throws a typed ExtractionError after two failed attempts, without fabricating a default', async () => {
    callClaudeMock.mockResolvedValueOnce(claudeResult('not json'));
    callClaudeMock.mockResolvedValueOnce(claudeResult('still not json'));

    await expect(extractAttributes('Malformed input.')).rejects.toBeInstanceOf(ExtractionError);
    expect(callClaudeMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed ExtractionError when the schema validates but a required field is missing', async () => {
    callClaudeMock.mockResolvedValueOnce(claudeResult(JSON.stringify({ property_type: 'condo' })));
    callClaudeMock.mockResolvedValueOnce(claudeResult(JSON.stringify({ property_type: 'condo' })));

    await expect(extractAttributes('Some description.')).rejects.toBeInstanceOf(ExtractionError);
  });
});
