'use client';

import { useEffect, useState } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

type HealthResult =
  | { state: 'loading' }
  | { state: 'ok'; status: string; db: string }
  | { state: 'error'; detail: string };

export default function Home() {
  const [health, setHealth] = useState<HealthResult>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function fetchHealth() {
      try {
        const response = await fetch(`${BACKEND_URL}/health`);
        const body = await response.json();

        if (cancelled) return;

        if (response.ok) {
          setHealth({ state: 'ok', status: body.status, db: body.db });
        } else {
          setHealth({ state: 'error', detail: body.detail ?? 'Unknown error' });
        }
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : 'Failed to reach backend';
        setHealth({ state: 'error', detail });
      }
    }

    fetchHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-24">
      <h1 className="text-2xl font-semibold">Discovery Engine</h1>
      <div className="rounded-md border px-4 py-3 text-sm">
        {health.state === 'loading' && <p>Checking backend health…</p>}
        {health.state === 'ok' && (
          <p className="text-green-700">
            Backend status: <strong>{health.status}</strong> — DB: <strong>{health.db}</strong>
          </p>
        )}
        {health.state === 'error' && (
          <p className="text-red-700">Backend unreachable: {health.detail}</p>
        )}
      </div>
    </main>
  );
}
