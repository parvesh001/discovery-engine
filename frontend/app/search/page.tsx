'use client';

import { SearchForm } from './SearchForm';
import { ResultsColumn } from './ResultsColumn';
import { LOADING_STAGES, useSearch } from './useSearch';

export default function SearchPage() {
  const { query, setQuery, ai, naive, submit } = useSearch();
  const isLoading = ai.status === 'loading' || naive.status === 'loading';

  return (
    <main className="min-h-screen bg-white px-4 py-10 dark:bg-gray-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">Discovery Search</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Compare a naive keyword search against the AI-powered semantic pipeline for the same
          query.
        </p>

        <div className="mt-6">
          <SearchForm value={query} onChange={setQuery} onSubmit={() => submit(query)} disabled={isLoading} />
        </div>

        <div className="mt-3 min-h-[1.5rem] text-sm text-gray-500 dark:text-gray-400" aria-live="polite">
          {ai.status === 'loading' && LOADING_STAGES[ai.stage]}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <ResultsColumn
            id="naive"
            heading="Naive search (ILIKE)"
            status={naive.status}
            loadingLabel="Searching…"
            errorMessage={naive.status === 'error' ? naive.message : undefined}
            listings={naive.status === 'success' ? naive.data.results : undefined}
          />
          <ResultsColumn
            id="ai"
            heading="AI pipeline"
            status={ai.status}
            loadingLabel="Working…"
            errorMessage={ai.status === 'error' ? ai.message : undefined}
            listings={ai.status === 'success' ? ai.data.results : undefined}
            filtersRelaxed={ai.status === 'success' ? ai.data.filtersRelaxed : undefined}
            degraded={ai.status === 'success' ? ai.data.degraded : undefined}
          />
        </div>
      </div>
    </main>
  );
}
