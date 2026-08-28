// autocannon@8 ships no bundled types and @types/autocannon only covers up to v7 — this
// declares only the narrow surface loadtest.ts actually calls, rather than pulling in a
// version-mismatched external types package.
declare module 'autocannon' {
  export type Request = {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  export type RequestOptions = Request & {
    setupRequest?: (request: Request, context: Record<string, unknown>) => Request;
  };

  export type Options = {
    url: string;
    connections?: number;
    duration?: number;
    requests?: RequestOptions[];
  };

  export type PercentileStats = {
    p50: number;
    p97_5: number;
    p99: number;
    mean: number;
    min: number;
    max: number;
  };

  export type Result = {
    duration: number;
    connections: number;
    errors: number;
    timeouts: number;
    non2xx: number;
    requests: { sent: number };
    latency: PercentileStats;
  };

  export default function autocannon(opts: Options): Promise<Result>;
}
