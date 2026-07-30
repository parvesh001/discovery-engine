import { describe, expect, it } from 'vitest';
import { costPerListingIngested, costPerQuery } from './costModel.js';

describe('costPerQuery', () => {
  it('computes zero cost for zero usage', () => {
    expect(costPerQuery(0, 0, 0, 0)).toBe(0);
  });

  it('sums Haiku (query_understanding) + Voyage embedding + Voyage rerank cost', () => {
    // 1,000,000 input tokens @ $1.00/1M = $1.00
    // 1,000,000 output tokens @ $5.00/1M = $5.00
    // 1,000,000 embedding tokens @ $0.06/1M = $0.06
    // 1,000,000 rerank tokens @ $0.05/1M = $0.05
    const result = costPerQuery(1_000_000, 1_000_000, 1_000_000, 1_000_000);
    expect(result).toBeCloseTo(1.0 + 5.0 + 0.06 + 0.05, 6);
  });

  it('scales linearly with token count', () => {
    const single = costPerQuery(100, 50, 10, 20);
    const doubled = costPerQuery(200, 100, 20, 40);
    expect(doubled).toBeCloseTo(single * 2, 10);
  });
});

describe('costPerListingIngested', () => {
  it('computes zero cost for zero usage', () => {
    expect(costPerListingIngested(0, 0, 0)).toBe(0);
  });

  it('sums Haiku (extraction) + Voyage embedding cost, excluding rerank', () => {
    const result = costPerListingIngested(1_000_000, 1_000_000, 1_000_000);
    expect(result).toBeCloseTo(1.0 + 5.0 + 0.06, 6);
  });
});
