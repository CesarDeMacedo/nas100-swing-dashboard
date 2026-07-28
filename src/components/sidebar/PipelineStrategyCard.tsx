import { TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { num } from '../MeanReversionPanel';
import { formatTorontoTime } from '../../lib/format';
import { actionLabel, type DashboardState } from '../../application/buildDashboardState';
import type { SafeAnalysis } from '../../domain/analysis';
import { InstructionCard } from './InstructionCard';

type PipelineCardData = {
  instrument: string;
  timeframe: string;
  action: string;
  actionLabel: string;
  bias: string;
  direction: 'long' | 'short' | 'none';
  entryDisplay: string;
  stopPrice: number | null;
  invalidationPrice: number | null;
  targets: number[];
  estimatedRewardRisk: number | null;
  sourceCandleTime: string | null;
  primaryReason: string;
};

/** The live/mock view has a fully computed DashboardState (see buildDashboardState.ts) —
 * numeric entryPrice when confirmed, entryTrigger text otherwise. */
const fromDashboardState = (state: DashboardState): PipelineCardData => ({
  instrument: state.instrument,
  timeframe: state.timeframe,
  action: state.action,
  actionLabel: state.actionLabel,
  bias: state.bias,
  direction: state.direction,
  entryDisplay: state.entryPrice !== null ? num(state.entryPrice) : (state.entryTrigger ?? 'Not confirmed'),
  stopPrice: state.stopPrice,
  invalidationPrice: state.invalidationPrice,
  targets: state.targets,
  estimatedRewardRisk: state.estimatedRewardRisk,
  sourceCandleTime: state.sourceCandleTime,
  primaryReason: state.primaryReason,
});

/** A saved/persisted OANDA report (SafeAnalysis) carries the same decision fields under
 * slightly different names, and — since ADR-018 removed the OANDA pipeline's entry-
 * authorization clamp (see docs/DECISIONS.md) — the persisted `action` is the real computed
 * decision, not a forced WAIT. No raw numeric entry price is persisted, only the descriptive
 * `entryTrigger`, so the entry cell falls back to that text (or 'Not confirmed'). */
const fromSafeAnalysis = (analysis: SafeAnalysis): PipelineCardData => ({
  instrument: analysis.instrument,
  timeframe: analysis.timeframe,
  action: analysis.action,
  actionLabel: actionLabel(analysis.action),
  bias: analysis.bias,
  direction: analysis.action === 'BUY' ? 'long' : analysis.action === 'SELL' ? 'short' : 'none',
  entryDisplay: analysis.entryTrigger ?? 'Not confirmed',
  stopPrice: analysis.stop ?? null,
  invalidationPrice: analysis.invalidation ?? null,
  targets: analysis.targets,
  estimatedRewardRisk: analysis.estimatedRR ?? null,
  sourceCandleTime: analysis.completedCandleAt,
  primaryReason: analysis.reason ?? 'No decision reason was recorded for this saved report.',
});

type PipelineStrategyCardProps = {
  state?: DashboardState;
  analysis?: SafeAnalysis;
  onOpenHistory?: () => void;
};

/** BUY/SELL need action today, so they get the sidebar's 'danger' (attention-red) tone — the
 * same convention EvaluationCard uses for ENTER/EXIT. WAIT_FOR_PULLBACK/WAIT_FOR_NEXT_4H_CLOSE
 * are "getting close", so they get 'warning'; WAIT/NO_TRADE are steady-state 'context'. */
const toneFor = (action: string) =>
  action === 'BUY' || action === 'SELL'
    ? ('danger' as const)
    : action === 'WAIT_FOR_PULLBACK' || action === 'WAIT_FOR_NEXT_4H_CLOSE'
      ? ('warning' as const)
      : ('context' as const);

function StatusCard({ children }: { children: ReactNode }) {
  return (
    <InstructionCard
      title="Pipeline strategy"
      icon={TrendingUp}
      tone="context"
      testId="pipeline-strategy-card"
    >
      {children}
    </InstructionCard>
  );
}

/** Live counterpart to the pipeline's own decision engine (daily-trend bias + H4 pullback
 * entry, see decideStrategy/strategyDecision.ts) — this was dormant/invisible in the default
 * dashboard view until the Patience Filter's event-risk/cross-market gates became advisory-only
 * (patienceFilter.ts) and ADR-018 removed the OANDA pipeline's separate entry-authorization
 * clamp (docs/DECISIONS.md). Mirrors MeanReversionStrategyCard's layout so both live strategies
 * read as one consistent sidebar. Renders from `state` (DashboardState, the live/mock
 * recomputed view) when available, falling back to `analysis` (the persisted SafeAnalysis
 * fields) so the saved-OANDA-snapshot view — the default view on app open — shows the same
 * decision instead of "Not available". */
export function PipelineStrategyCard({ state, analysis, onOpenHistory }: PipelineStrategyCardProps) {
  const data = state ? fromDashboardState(state) : analysis ? fromSafeAnalysis(analysis) : null;

  if (!data)
    return (
      <StatusCard>
        <p className="narrative-fallback">No pipeline decision is available yet.</p>
      </StatusCard>
    );

  const targetsText = data.targets.length > 0 ? data.targets.map((target) => num(target)).join(' / ') : 'None';

  return (
    <InstructionCard
      title="Pipeline · Daily trend + H4 pullback"
      icon={TrendingUp}
      tone={toneFor(data.action)}
      testId="pipeline-strategy-card"
    >
      <div className="mr-strategy-card__body">
        <div className="mr-strategy-card__headline">
          <span
            className={`mr-strategy-card__signal mr-strategy-card__signal--${data.action === 'BUY' || data.action === 'SELL' ? 'enter' : data.action === 'WAIT_FOR_PULLBACK' || data.action === 'WAIT_FOR_NEXT_4H_CLOSE' ? 'hold' : 'flat'}`}
          >
            {data.actionLabel}
          </span>
          <span className="mr-strategy-card__meta">
            {data.instrument} {data.timeframe} · bias {data.bias}
          </span>
        </div>
        <dl className="mr-strategy-card__facts">
          <div>
            <dt>Direction</dt>
            <dd>{data.direction === 'none' ? '—' : data.direction.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Entry</dt>
            <dd>{data.entryDisplay}</dd>
          </div>
          <div>
            <dt>Stop</dt>
            <dd>{num(data.stopPrice)}</dd>
          </div>
          <div>
            <dt>Invalidation</dt>
            <dd>{num(data.invalidationPrice)}</dd>
          </div>
          <div>
            <dt>Targets</dt>
            <dd>{targetsText}</dd>
          </div>
          <div>
            <dt>Est. reward:risk</dt>
            <dd>{data.estimatedRewardRisk === null ? 'Not available' : `${data.estimatedRewardRisk.toFixed(2)}R`}</dd>
          </div>
          <div>
            <dt>Last evaluated</dt>
            <dd>{data.sourceCandleTime === null ? 'Not available' : formatTorontoTime(data.sourceCandleTime)}</dd>
          </div>
        </dl>
        <p className="mr-strategy-card__exit-note">{data.primaryReason}</p>
        <p className="mr-strategy-card__exit-note">
          Event risk and cross-market confirmation are advisory only here — they no longer block
          or delay this signal, so weigh them yourself before entering.
        </p>
        {onOpenHistory ? (
          <button type="button" className="mr-strategy-card__history-link" onClick={onOpenHistory}>
            View analysis history
          </button>
        ) : null}
      </div>
    </InstructionCard>
  );
}
