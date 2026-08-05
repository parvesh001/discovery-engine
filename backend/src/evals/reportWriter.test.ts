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
    // Regression check: the header and the first marker must be on separate lines, not
    // glued together as "# Eval Report<!-- EVAL_RESULTS -->" (a real bug found via
    // loadtest.ts's first run against a brand-new LOAD_TEST_REPORT.md).
    expect(result.startsWith('# Eval Report\n\n<!-- EVAL_RESULTS -->')).toBe(true);
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

  it('uses a custom fileTitle for a brand-new file, defaulting to "# Eval Report" otherwise', () => {
    const withDefault = upsertSection('', 'EVAL_RESULTS', 'Pass rate: 90%');
    expect(withDefault).toContain('# Eval Report');

    const withCustomTitle = upsertSection('', 'LOAD_TEST', 'P50: 200ms', '# Load Test Report');
    expect(withCustomTitle).toContain('# Load Test Report');
    expect(withCustomTitle).not.toContain('# Eval Report');
    expect(withCustomTitle).toContain('<!-- LOAD_TEST -->');
    expect(withCustomTitle).toContain('## Load Test');
  });
});
