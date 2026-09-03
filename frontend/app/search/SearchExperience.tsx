'use client';

import { SearchForm } from './SearchForm';
import { ResultsColumn } from './ResultsColumn';
import { PipelineTrace } from './PipelineTrace';
import { DestinationPicker } from './DestinationPicker';
import { BrowseResults } from './BrowseResults';
import { destinationLabel } from './destinations';
import { LOADING_STAGES, useSearch } from './useSearch';

export function SearchExperience() {
  const { destination, mode, query, setQuery, ai, naive, browse, selectDestination, backToBrowse, submit } = useSearch();
  const isLoading = ai.status === 'loading' || naive.status === 'loading';
  const submittedQuery = query.trim();
  const label = destinationLabel(destination);

  return (
    <main className="min-h-screen bg-graphite px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-heading text-2xl font-semibold text-signal">Discovery Search</h1>
        <p className="mt-1 text-sm text-mist">
          Browse a destination, then compare a naive keyword search against the AI-powered semantic
          pipeline — scoped to that destination.
        </p>

        <div className="mt-6">
          <DestinationPicker value={destination} onSelect={selectDestination} />
        </div>

        <div className="mt-4">
          <SearchForm value={query} onChange={setQuery} onSubmit={() => submit(query)} disabled={isLoading} />
        </div>

        {/* Instrumentation rule: the active scope bound is always on screen, in both modes.
            Decorative — the scope is also stated in the browse heading and the compare copy. */}
        <div className="mt-3 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-hairline" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-mist-dim">Scope: {label}</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        {mode === 'browse' && (
          <div className="mt-6">
            <BrowseResults destination={destination} state={browse} />
          </div>
        )}

        {mode === 'compare' && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={backToBrowse}
                className="text-xs font-medium text-mist underline decoration-hairline underline-offset-4 hover:text-signal hover:decoration-signal"
              >
                &larr; Back to all {label} stays
              </button>
              <span className="text-sm text-mist">
                Searching within <span className="font-semibold text-signal">{label}</span>
              </span>
            </div>

            {/* Visually hidden: the PipelineTrace stepper is aria-hidden and purely decorative,
                so this is the only announcement screen readers get for stage progress. */}
            <div className="sr-only" aria-live="polite">
              {ai.status === 'loading' && LOADING_STAGES[ai.stage]}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
              <ResultsColumn
                id="naive"
                heading="Naive search (ILIKE)"
                variant="naive"
                status={naive.status}
                loadingLabel="Searching…"
                errorMessage={naive.status === 'error' ? naive.message : undefined}
                listings={naive.status === 'success' ? naive.data.results : undefined}
                emptyMessage={`0 rows matched '%${submittedQuery}%' in ${label}`}
                trace={
                  submittedQuery && naive.status !== 'idle' ? (
                    <p className="font-mono text-xs text-mist" aria-hidden="true">
                      MATCH ILIKE {"'%"}
                      {submittedQuery}
                      {"%'"} · destination = {destination} · no ranking
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
                    <PipelineTrace status="success" timing={ai.data.timing} degraded={ai.data.degraded} />
                  ) : undefined
                }
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
