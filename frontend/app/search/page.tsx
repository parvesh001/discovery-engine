import { Suspense } from 'react';
import { SearchExperience } from './SearchExperience';

// SearchExperience reads `?destination=` via useSearchParams(), which App Router requires
// to sit inside a Suspense boundary.
export default function SearchPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-graphite px-4 py-10" />}>
      <SearchExperience />
    </Suspense>
  );
}
