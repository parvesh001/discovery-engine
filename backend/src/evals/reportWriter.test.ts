import { describe, expect, it } from 'vitest';
import { upsertSection } from './reportWriter.js';

describe('upsertSection', () => {
  it('appends a new section with a fresh header when the file is empty', () => {
    const result = upsertSection('', 'EVAL_RESULTS', 'Pass rate: 90%');

    expect(result).toContain('# Eval Report');
    expect(result).toContain('<!-- EVAL_RESULTS -->');
    expect(result).toContain('## Eval Results');
    expect(result).toContain('Pass rate: 90%');
    expect(result).toContain('<!-- /EVAL_RESULTS -->');
  });

  it('appends a second section after an existing one, preserving it untouched', () => {
    const withEval = upsertSection('', 'EVAL_RESULTS', 'Pass rate: 90%');
    const withBoth = upsertSection(withEval, 'COST_MODEL', '$0.002/query');

    expect(withBoth).toContain('Pass rate: 90%');
    expect(withBoth).toContain('$0.002/query');
    expect(withBoth.indexOf('EVAL_RESULTS')).toBeLessThan(withBoth.indexOf('COST_MODEL'));
  });

  it('replaces an existing section in place on re-run, without touching other sections', () => {
    const first = upsertSection('', 'EVAL_RESULTS', 'Pass rate: 80%');
    const withCost = upsertSection(first, 'COST_MODEL', '$0.002/query');
    const rerun = upsertSection(withCost, 'EVAL_RESULTS', 'Pass rate: 95%');

    expect(rerun).not.toContain('Pass rate: 80%');
    expect(rerun).toContain('Pass rate: 95%');
    expect(rerun).toContain('$0.002/query');
    // Exactly one instance of each marker pair — no duplication from the replace.
    expect(rerun.match(/<!-- EVAL_RESULTS -->/g)).toHaveLength(1);
    expect(rerun.match(/<!-- \/EVAL_RESULTS -->/g)).toHaveLength(1);
  });
});
