type Timing = { understanding_ms: number; retrieval_ms: number; rerank_ms: number; total_ms: number };

const STEPS = ['UNDERSTAND', 'RETRIEVE', 'RERANK'] as const;

/**
 * The AI column's signature element: a 3-node stepper while the real pipeline is
 * in-flight, collapsing into a persistent monospace readout of the real per-stage
 * timing once the response lands. `timing` already comes back from every
 * `POST /api/search` call (see SearchResponse) but was previously fetched and thrown
 * away — this is the first place it's actually shown. Purely presentational/decorative
 * (aria-hidden): the existing aria-live stage announcement elsewhere covers screen readers.
 */
type PipelineTraceProps = { status: 'loading'; stage: number } | { status: 'success'; timing: Timing };

export function PipelineTrace(props: PipelineTraceProps) {
  if (props.status === 'success') {
    const { timing } = props;
    return (
      <p className="font-mono text-xs text-mist" aria-hidden="true">
        UNDERSTAND {timing.understanding_ms}ms · RETRIEVE {timing.retrieval_ms}ms · RERANK {timing.rerank_ms}ms ·{' '}
        {timing.total_ms}ms total
      </p>
    );
  }

  const { stage } = props;

  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {STEPS.map((step, index) => {
        const active = index <= stage;
        return (
          <div key={step} className="flex items-center gap-2">
            {index > 0 && <div className={`h-px w-4 ${active ? 'bg-flare' : 'bg-hairline'}`} />}
            <div className="flex items-center gap-1.5">
              <div className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-flare' : 'bg-hairline'}`} />
              <span className={`font-mono text-[10px] tracking-wider ${active ? 'text-flare' : 'text-mist'}`}>
                {step}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
