'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  isBrowseResponse,
  isNaiveSearchResponse,
  isSearchResponse,
  type BrowseResponse,
  type NaiveSearchResponse,
  type SearchResponse,
} from './types';
import { DEFAULT_DESTINATION_SLUG, isDestinationSlug } from './destinations';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

export const LOADING_STAGES = ['Understanding your search…', 'Finding matches…', 'Ranking results…'] as const;

export type AiColumnState =
  | { status: 'idle' }
  | { status: 'loading'; stage: number }
  | { status: 'error'; message: string }
  | { status: 'success'; data: SearchResponse };

export type NaiveColumnState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: NaiveSearchResponse };

export type BrowseState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: BrowseResponse };

/** browse → no active query (default view); compare → a query has been submitted. */
export type SearchMode = 'browse' | 'compare';

const GENERIC_FETCH_ERROR = "Couldn't reach the search backend.";
const RATE_LIMIT_ERROR = "You're searching a bit too quickly. Please wait a moment and try again.";

export function useSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The URL is the source of truth for the destination — deep-link / reload stable. There
  // is no "no destination" state (spec 12, "Revised During Implementation"): a missing or
  // unknown ?destination= defaults to the first registry entry, so the toggle + browse
  // list render together from the first paint. The URL is only rewritten once the user
  // actually picks (selectDestination), not on a bare visit.
  const urlDestination = searchParams.get('destination');
  const destination = isDestinationSlug(urlDestination) ? urlDestination : DEFAULT_DESTINATION_SLUG;

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [ai, setAi] = useState<AiColumnState>({ status: 'idle' });
  const [naive, setNaive] = useState<NaiveColumnState>({ status: 'idle' });
  const [browse, setBrowse] = useState<BrowseState>({ status: 'idle' });
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const mode: SearchMode = submittedQuery ? 'compare' : 'browse';

  const clearStageTimers = useCallback(() => {
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
  }, []);

  useEffect(() => clearStageTimers, [clearStageTimers]);

  const resetSearchColumns = useCallback(() => {
    clearStageTimers();
    setQuery('');
    setSubmittedQuery('');
    setAi({ status: 'idle' });
    setNaive({ status: 'idle' });
  }, [clearStageTimers]);

  // Load the browse list on mount and whenever the destination changes (there is always a
  // destination — see above). No AI pipeline — plain SQL read.
  useEffect(() => {
    let cancelled = false;
    setBrowse({ status: 'loading' });

    fetch(`${BACKEND_URL}/api/listings?destination=${encodeURIComponent(destination)}`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 429) {
          setBrowse({ status: 'error', message: RATE_LIMIT_ERROR });
          return;
        }
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok || !isBrowseResponse(body)) {
          setBrowse({ status: 'error', message: "Couldn't load listings for this destination." });
          return;
        }
        setBrowse({ status: 'success', data: body });
      })
      .catch(() => {
        if (!cancelled) setBrowse({ status: 'error', message: GENERIC_FETCH_ERROR });
      });

    return () => {
      cancelled = true;
    };
  }, [destination]);

  // Clearing the input back to empty drops out of the compare view and back to browse.
  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    if (value.trim() === '') setSubmittedQuery('');
  }, []);

  const selectDestination = useCallback(
    (slug: string) => {
      resetSearchColumns();
      router.push(`/search?destination=${encodeURIComponent(slug)}`);
    },
    [router, resetSearchColumns],
  );

  const backToBrowse = useCallback(() => {
    resetSearchColumns();
  }, [resetSearchColumns]);

  const submit = useCallback(
    async (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (trimmed.length === 0) return;

      clearStageTimers();
      setSubmittedQuery(trimmed);
      setAi({ status: 'loading', stage: 0 });
      setNaive({ status: 'loading' });

      // Simulated stage progression: spec 08 documents this as an accepted simplification
      // since no real per-stage timing is streamed from the backend. Stage advances on a
      // fixed timer and simply freezes wherever it is once the real response lands — never
      // advances past what's already showing.
      stageTimers.current.push(
        setTimeout(() => setAi((prev) => (prev.status === 'loading' ? { status: 'loading', stage: 1 } : prev)), 600),
        setTimeout(() => setAi((prev) => (prev.status === 'loading' ? { status: 'loading', stage: 2 } : prev)), 1400),
      );

      const aiRequest = fetch(`${BACKEND_URL}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, destination }),
      })
        .then(async (response) => {
          // Rate limiter (backend spec 10, req. 2) returns 429 with a non-SearchResponse
          // body — check status before parsing so it gets its own message, not the generic
          // "couldn't load" fallback meant for genuinely malformed responses.
          if (response.status === 429) {
            setAi({ status: 'error', message: RATE_LIMIT_ERROR });
            return;
          }
          const body: unknown = await response.json().catch(() => undefined);
          if (!response.ok || !isSearchResponse(body)) {
            setAi({ status: 'error', message: "Couldn't load AI results." });
            return;
          }
          setAi({ status: 'success', data: body });
        })
        .catch(() => setAi({ status: 'error', message: GENERIC_FETCH_ERROR }));

      const naiveRequest = fetch(
        `${BACKEND_URL}/api/search/naive?q=${encodeURIComponent(trimmed)}&destination=${encodeURIComponent(destination)}`,
      )
        .then(async (response) => {
          // Shares the search rate limiter, so a 429 lands here too — same distinct message.
          if (response.status === 429) {
            setNaive({ status: 'error', message: RATE_LIMIT_ERROR });
            return;
          }
          const body: unknown = await response.json().catch(() => undefined);
          if (!response.ok || !isNaiveSearchResponse(body)) {
            setNaive({ status: 'error', message: "Couldn't load naive results." });
            return;
          }
          setNaive({ status: 'success', data: body });
        })
        .catch(() => setNaive({ status: 'error', message: GENERIC_FETCH_ERROR }));

      await Promise.all([aiRequest, naiveRequest]);
      clearStageTimers();
    },
    [clearStageTimers, destination],
  );

  return {
    destination,
    mode,
    query,
    setQuery: updateQuery,
    ai,
    naive,
    browse,
    selectDestination,
    backToBrowse,
    submit,
  };
}
