import { Fragment, type ReactNode } from 'react';

type Timing = { understanding_ms: number; retrieval_ms: number; rerank_ms: number; total_ms: number };

type StageKey = 'understand' | 'retrieve' | 'rerank';

const STAGES: ReadonlyArray<{ key: StageKey; label: string }> = [
  { key: 'understand', label: 'Understand' },
  { key: 'retrieve', label: 'Retrieve' },
  { key: 'rerank', label: 'Rerank' },
];

const TIMING_FIELD: Record<StageKey, keyof Timing> = {
  understand: 'understanding_ms',
  retrieve: 'retrieval_ms',
  rerank: 'rerank_ms',
};

/**
 * The AI column's signature element: a 3-stage instrument stepper that is *always*
 * rendered in compare mode — a live progress readout while the real pipeline is
 * in-flight, then a persistent per-stage timing readout once the response lands. It is
 * never collapsed and never behind a toggle; it is instead made visually secondary
 * (recessed `well` surface, `text-xs`/`[10px]` mono micro-labels, low-contrast text
 * tiers — only the real measured ms pick up `flare`).
 *
 * `timing` comes back on every `POST /api/search` response (see SearchResponse); `flare`
 * is reserved for it here because it is the one genuinely-measured value on screen.
 *
 * The visual tree is `aria-hidden` (as before) — screen readers get the existing
 * `aria-live` stage announcement in SearchExperience during loading, plus the `sr-only`
 * summary sentence emitted here on success.
 */
type PipelineTraceProps =
  | { status: 'loading'; stage: number }
  | { status: 'success'; timing: Timing; degraded: boolean };

function StageIcon({ kind, className }: { kind: StageKey; className?: string }) {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
  if (kind === 'understand') {
    // parse / read: lines of text
    return (
      <svg {...common}>
        <path d="M2.5 4h8" />
        <path d="M2.5 8h11" />
        <path d="M2.5 12h6" />
      </svg>
    );
  }
  if (kind === 'retrieve') {
    // pull candidate rows from a store
    return (
      <svg {...common}>
        <rect x="2.5" y="2.75" width="11" height="3.5" rx="1" />
        <rect x="2.5" y="7.75" width="11" height="3.5" rx="1" />
        <path d="M2.5 13.25h7" />
      </svg>
    );
  }
  // rerank: reorder (up/down)
  return (
    <svg {...common}>
      <path d="M5 3v10M5 3 3 5M5 3l2 2" />
      <path d="M11 13V3M11 13l-2-2M11 13l2 2" />
    </svg>
  );
}

export function PipelineTrace(props: PipelineTraceProps) {
  const loading = props.status === 'loading';
  const activeStage = loading ? props.stage : STAGES.length - 1;

  // A node (and the connector segment leading into it) is "reached" once the pipeline has
  // advanced to at least that stage. On success every stage is reached.
  const reached = (i: number): boolean => !loading || i <= activeStage;

  return (
    <div className="rounded-md border border-hairline bg-well px-3 py-2.5">
      <ol aria-hidden="true" className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-0">
        {STAGES.map((stage, i) => {
          const isReached = reached(i);
          const isActive = loading && i === activeStage;

          const bezelRing =
            isReached && loading
              ? 'ring-flare text-flare'
              : isReached
                ? 'ring-hairline text-signal'
                : 'ring-hairline text-mist-dim';
          const labelColor = isReached && loading ? 'text-flare' : 'text-mist';

          let valueNode: ReactNode = null;
          if (props.status === 'loading') {
            valueNode = isActive ? <span className="text-mist-dim">···</span> : null;
          } else if (props.degraded && stage.key === 'rerank') {
            valueNode = (
              <span className="flex items-baseline gap-1">
                <span className="text-mist-dim">—</span>
                <span className="text-[10px] uppercase tracking-wider text-probe">Fallback</span>
              </span>
            );
          } else {
            valueNode = <span className="text-flare">{props.timing[TIMING_FIELD[stage.key]]} ms</span>;
          }

          return (
            <Fragment key={stage.key}>
              {i > 0 && (
                <li
                  aria-hidden="true"
                  className={[
                    'ml-[13px] h-3 w-px shrink-0 sm:ml-0 sm:mt-[13px] sm:h-px sm:w-auto sm:flex-1',
                    isReached ? 'bg-flare' : 'bg-edge',
                    loading && i === activeStage ? 'animate-pulse' : '',
                  ].join(' ')}
                />
              )}
              <li className="flex items-center gap-2 sm:flex-col sm:items-center sm:gap-1 sm:text-center">
                <span
                  className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ring-1 ${bezelRing}`}
                >
                  <StageIcon kind={stage.key} className="h-[14px] w-[14px]" />
                </span>
                <span className="flex items-baseline gap-1.5 font-mono sm:flex-col sm:items-center sm:gap-0.5">
                  <span className={`text-[10px] uppercase tracking-wider ${labelColor}`}>{stage.label}</span>
                  <span className="text-[11px]">{valueNode}</span>
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>

      {props.status === 'success' && (
        <p aria-hidden="true" className="mt-1.5 text-right font-mono text-[10px] text-mist">
          Σ {props.timing.total_ms} ms total
        </p>
      )}

      {props.status === 'success' && (
        <p className="sr-only">
          Pipeline complete: understand {props.timing.understanding_ms} ms, retrieve {props.timing.retrieval_ms} ms,
          rerank {props.timing.rerank_ms} ms, total {props.timing.total_ms} ms
          {props.degraded ? ', rerank fell back to similarity order' : ''}.
        </p>
      )}
    </div>
  );
}
