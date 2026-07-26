import { useEffect } from 'react';

import { formatTorontoTime } from '../lib/format';
import type {
  MeanReversionEvaluation,
  MrEvaluationsListResult,
} from '../serviceClient/localAnalysisService';

type MeanReversionPanelProps = {
  open: boolean;
  list: MrEvaluationsListResult | { kind: 'loading' } | null;
  onClose: () => void;
  onRefresh: () => void;
};

const signalClass = (signal: MeanReversionEvaluation['signal']) =>
  signal === 'ENTER' || signal === 'EXIT' ? 'history-row--selected' : '';

export const num = (value: number | null, digits = 2) =>
  value === null ? 'Not available' : value.toFixed(digits);

/** Position sizing is only ever computed on ENTER/HOLD with a configured protective stop and a
 * known account size (see meanReversionRun.ts) — this mirrors that precedence so callers report
 * the actual reason sizing is unavailable, rather than always blaming account size. Shared by
 * this panel's history rows and the sidebar's live-status card (MeanReversionStrategyCard) so
 * the two surfaces never describe the same evaluation differently. */
export const describeMrPositionSize = (evaluation: MeanReversionEvaluation) => {
  if (evaluation.suggestedPositionSizeUnits !== null) {
    return `${num(evaluation.suggestedPositionSizeUnits, 4)} units (${num(evaluation.suggestedRiskAmount)})`;
  }
  if (evaluation.signal !== 'ENTER' && evaluation.signal !== 'HOLD') return 'no open position';
  if (evaluation.stopPrice === null) return 'no protective stop configured';
  return 'account size not configured';
};

export function MeanReversionPanel({ open, list, onClose, onRefresh }: MeanReversionPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="history-overlay" role="presentation">
      <aside
        className="history-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Mean-reversion evaluations"
      >
        <header>
          <div>
            <span>Evaluation history</span>
            <h2>Mean-reversion strategies</h2>
          </div>
          <div>
            <button type="button" onClick={onRefresh}>
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close mean-reversion evaluations"
              autoFocus
            >
              Close
            </button>
          </div>
        </header>
        <div className="history-panel__content">
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Read-only, analysis-only. No orders are placed by this dashboard; ENTER/EXIT are
            informational signals only. The current status of each active strategy is also shown on
            the dashboard sidebar — this list is the full record for audit.
          </p>
          {list?.kind === 'loading' ? <p>Loading evaluations...</p> : null}
          {list?.kind === 'failed' || list?.kind === 'malformed_response' ? (
            <p>{list.message}</p>
          ) : null}
          {list?.kind === 'succeeded' && list.evaluations.length === 0 ? (
            <p>No active mean-reversion strategy has been evaluated yet.</p>
          ) : null}
          {list?.kind === 'succeeded' ? (
            <div className="history-list">
              {list.evaluations.map((evaluation) => (
                <div
                  key={evaluation.id}
                  className={`history-row ${signalClass(evaluation.signal)}`.trim()}
                >
                  <strong>
                    {evaluation.instrument} {evaluation.timeframe} | {evaluation.signal}
                  </strong>
                  <span>
                    strategy {evaluation.strategyId.slice(0, 8)} v{evaluation.version} | ref{' '}
                    {num(evaluation.referenceClose)} @{' '}
                    {formatTorontoTime(evaluation.referenceCandleTime)}
                  </span>
                  <span>
                    stop {num(evaluation.stopPrice)} | exit watch (close ≥){' '}
                    {num(evaluation.exitWatchPrice)} | ATR {num(evaluation.atr)} | SMA filter{' '}
                    {evaluation.aboveSmaFilter === null
                      ? 'n/a'
                      : evaluation.aboveSmaFilter
                        ? 'above'
                        : 'below'}
                  </span>
                  <small>
                    risk {evaluation.riskPerTradePct}% | size {describeMrPositionSize(evaluation)} |
                    evaluated {formatTorontoTime(evaluation.evaluatedAt)}
                  </small>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
