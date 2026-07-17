import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/discovery_engine',
  ANTHROPIC_API_KEY: 'sk-ant-test-key',
  PORT: '4000',
};

describe('loadEnv', () => {
  it('returns parsed env when all required vars are present and valid', () => {
    const env = loadEnv(validEnv);
    expect(env).toEqual({
      DATABASE_URL: validEnv.DATABASE_URL,
      ANTHROPIC_API_KEY: validEnv.ANTHROPIC_API_KEY,
      PORT: 4000,
    });
  });

  it('throws naming DATABASE_URL when it is missing', () => {
    const { DATABASE_URL: _DATABASE_URL, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws naming ANTHROPIC_API_KEY when it is missing', () => {
    const { ANTHROPIC_API_KEY: _ANTHROPIC_API_KEY, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('throws naming PORT when it is missing', () => {
    const { PORT: _PORT, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrow(/PORT/);
  });

  it('throws when DATABASE_URL is not a valid URL', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('throws when PORT is not numeric', () => {
    expect(() => loadEnv({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('throws when PORT is out of range', () => {
    expect(() => loadEnv({ ...validEnv, PORT: '99999' })).toThrow(/PORT/);
  });
});
