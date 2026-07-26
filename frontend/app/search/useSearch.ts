'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isNaiveSearchResponse, isSearchResponse, type NaiveSearchResponse, type SearchResponse } from './types';

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

const GENERIC_FETCH_ERROR = "Couldn't reach the search backend.";

export function useSearch() {
  const [query, setQuery] = useState('');
  const [ai, setAi] = useState<AiColumnState>({ status: 'idle' });
  const [naive, setNaive] = useState<NaiveColumnState>({ status: 'idle' });
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearStageTimers = useCallback(() => {
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
  }, []);

  useEffect(() => clearStageTimers, [clearStageTimers]);

  const submit = useCallback(
    async (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (trimmed.length === 0) return;

      clearStageTimers();
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
        body: JSON.stringify({ query: trimmed }),
      })
        .then(async (response) => {
          const body: unknown = await response.json().catch(() => undefined);
          if (!response.ok || !isSearchResponse(body)) {
            setAi({ status: 'error', message: "Couldn't load AI results." });
            return;
          }
          setAi({ status: 'success', data: body });
        })
        .catch(() => setAi({ status: 'error', message: GENERIC_FETCH_ERROR }));

      const naiveRequest = fetch(`${BACKEND_URL}/api/search/naive?q=${encodeURIComponent(trimmed)}`)
        .then(async (response) => {
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
    [clearStageTimers],
  );

  return { query, setQuery, ai, naive, submit };
}
