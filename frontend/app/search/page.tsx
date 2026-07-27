'use client';

import { SearchForm } from './SearchForm';
import { ResultsColumn } from './ResultsColumn';
import { PipelineTrace } from './PipelineTrace';
import { LOADING_STAGES, useSearch } from './useSearch';

export default function SearchPage() {
  const { query, setQuery, ai, naive, submit } = useSearch();
  const isLoading = ai.status === 'loading' || naive.status === 'loading';
  const submittedQuery = query.trim();

  return (
    <main className="min-h-screen bg-graphite px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-heading text-2xl font-semibold text-signal">Discovery Search</h1>
        <p className="mt-1 text-sm text-mist">
          Compare a naive keyword search against the AI-powered semantic pipeline for the same
          query.
        </p>

        <div className="mt-6">
          <SearchForm value={query} onChange={setQuery} onSubmit={() => submit(query)} disabled={isLoading} />
        </div>

        {/* Visually hidden: the PipelineTrace stepper is aria-hidden and purely decorative,
            so this is the only announcement screen readers get for stage progress. */}
        <div className="sr-only" aria-live="polite">
          {ai.status === 'loading' && LOADING_STAGES[ai.stage]}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <ResultsColumn
            id="naive"
            heading="Naive search (ILIKE)"
            variant="naive"
            status={naive.status}
            loadingLabel="Searching…"
            errorMessage={naive.status === 'error' ? naive.message : undefined}
            listings={naive.status === 'success' ? naive.data.results : undefined}
            emptyMessage={`0 rows matched '%${submittedQuery}%'`}
            trace={
              submittedQuery && naive.status !== 'idle' ? (
                <p className="font-mono text-xs text-mist" aria-hidden="true">
                  MATCH ILIKE {"'%"}
                  {submittedQuery}
                  {"%'"} → title, raw_description · no ranking · no filters
                </p>
              ) : undefined
            }
          />
          <ResultsColumn
            id="ai"
            heading="AI pipeline"
            variant="ai"
            status={ai.status}
            loadingLabel="Working…"
            errorMessage={ai.status === 'error' ? ai.message : undefined}
            listings={ai.status === 'success' ? ai.data.results : undefined}
            emptyMessage="No results found."
            filtersRelaxed={ai.status === 'success' ? ai.data.filtersRelaxed : undefined}
            degraded={ai.status === 'success' ? ai.data.degraded : undefined}
            trace={
              ai.status === 'loading' ? (
                <PipelineTrace status="loading" stage={ai.stage} />
              ) : ai.status === 'success' ? (
                <PipelineTrace status="success" timing={ai.data.timing} />
              ) : undefined
            }
          />
        </div>
      </div>
    </main>
  );
}
