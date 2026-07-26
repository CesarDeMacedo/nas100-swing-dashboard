import { Repeat } from 'lucide-react';
import type { ReactNode } from 'react';

import { describeMrPositionSize, num } from '../MeanReversionPanel';
import { formatTorontoTime } from '../../lib/format';
import type {
  MeanReversionEvaluation,
  MrEvaluationsListResult,
} from '../../serviceClient/localAnalysisService';
import { InstructionCard } from './InstructionCard';

type MeanReversionStrategyCardProps = {
  list: MrEvaluationsListResult | { kind: 'loading' } | null;
  onOpenHistory?: () => void;
};

const SIGNAL_LABEL: Record<MeanReversionEvaluation['signal'], string> = {
  ENTER: 'Enter now',
  HOLD: 'In position',
  EXIT: 'Exit now',
  FLAT: 'Flat, waiting',
};

/** ENTER/EXIT need action today, so they borrow the sidebar's 'danger' (attention-red) tone
 * used elsewhere for urgent items; HOLD/FLAT are steady-state, so they get the calmer
 * 'context' (info-blue) tone — same tone vocabulary the rest of the sidebar already uses. */
const toneFor = (signal: MeanReversionEvaluation['signal']) =>
  signal === 'ENTER' || signal === 'EXIT' ? ('danger' as const) : ('context' as const);

/** One card per active strategy — this is a two-strategy account (Double Seven D1 and H4
 * running simultaneously, see /mr-evaluations), and the two must stay visually separable since
 * they hold independent positions with different risk. Timeframe is the differentiator both
 * here and on the chart overlay (mapMeanReversionPriceLines). */
function EvaluationCard({
  evaluation,
  onOpenHistory,
}: {
  evaluation: MeanReversionEvaluation;
  onOpenHistory?: () => void;
}) {
  return (
    <InstructionCard
      title={`Mean-reversion · ${evaluation.timeframe}`}
      icon={Repeat}
      tone={toneFor(evaluation.signal)}
      testId={`mean-reversion-strategy-card-${evaluation.timeframe.toLowerCase()}`}
    >
      <div className="mr-strategy-card__body">
        <div className="mr-strategy-card__headline">
          <span
            className={`mr-strategy-card__signal mr-strategy-card__signal--${evaluation.signal.toLowerCase()}`}
          >
            {SIGNAL_LABEL[evaluation.signal]}
          </span>
          <span className="mr-strategy-card__meta">
            {evaluation.instrument} {evaluation.timeframe} · v{evaluation.version}
          </span>
        </div>
        <dl className="mr-strategy-card__facts">
          <div>
            <dt>Reference</dt>
            <dd>
              {num(evaluation.referenceClose)} @ {formatTorontoTime(evaluation.referenceCandleTime)}
            </dd>
          </div>
          <div>
            <dt>Stop</dt>
            <dd>{num(evaluation.stopPrice)}</dd>
          </div>
          <div>
            <dt>Suggested size</dt>
            <dd>{describeMrPositionSize(evaluation)}</dd>
          </div>
          <div>
            <dt>Last evaluated</dt>
            <dd>{formatTorontoTime(evaluation.evaluatedAt)}</dd>
          </div>
        </dl>
        {onOpenHistory ? (
          <button type="button" className="mr-strategy-card__history-link" onClick={onOpenHistory}>
            View evaluation history
          </button>
        ) : null}
      </div>
    </InstructionCard>
  );
}

function StatusCard({ children }: { children: ReactNode }) {
  return (
    <InstructionCard
      title="Mean-reversion strategy"
      icon={Repeat}
      tone="context"
      testId="mean-reversion-strategy-card"
    >
      {children}
    </InstructionCard>
  );
}

/** Persistent, always-visible counterpart to MeanReversionPanel (which is now framed as the
 * full audit history — see its updated header copy). Before this card existed the only way to
 * see whether a live Double Seven/RSI-2 strategy was in a position was to open that panel
 * manually; nothing about it appeared on the dashboard by default. Renders one card per active
 * strategy (today: Double Seven D1 and Double Seven H4, running simultaneously). */
export function MeanReversionStrategyCard({ list, onOpenHistory }: MeanReversionStrategyCardProps) {
  if (!list)
    return (
      <StatusCard>
        {<p className="narrative-fallback">Not available on the mock dashboard.</p>}
      </StatusCard>
    );
  if (list.kind === 'loading')
    return (
      <StatusCard>
        {<p className="narrative-fallback">Loading live strategy status...</p>}
      </StatusCard>
    );
  if (list.kind === 'failed' || list.kind === 'malformed_response')
    return <StatusCard>{<p className="narrative-fallback">{list.message}</p>}</StatusCard>;
  if (list.evaluations.length === 0) {
    return (
      <StatusCard>
        {
          <p className="narrative-fallback">
            No active mean-reversion strategy has been evaluated yet.
          </p>
        }
      </StatusCard>
    );
  }

  return (
    <>
      {list.evaluations.map((evaluation) => (
        <EvaluationCard
          key={evaluation.strategyConfigId}
          evaluation={evaluation}
          onOpenHistory={onOpenHistory}
        />
      ))}
    </>
  );
}
