import { useEffect } from 'react';

import type { MeanReversionEvaluation, MrEvaluationsListResult } from '../serviceClient/localAnalysisService';

type MeanReversionPanelProps = {
  open: boolean;
  list: MrEvaluationsListResult | { kind: 'loading' } | null;
  onClose: () => void;
  onRefresh: () => void;
};

const signalClass = (signal: MeanReversionEvaluation['signal']) =>
  signal === 'ENTER' || signal === 'EXIT' ? 'history-row--selected' : '';

const num = (value: number | null, digits = 2) => (value === null ? 'Not available' : value.toFixed(digits));

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
      <aside className="history-panel" role="dialog" aria-modal="true" aria-label="Mean-reversion evaluations">
        <header>
          <div><span>Local records</span><h2>Mean-reversion strategies</h2></div>
          <div>
            <button type="button" onClick={onRefresh}>Refresh</button>
            <button type="button" onClick={onClose} aria-label="Close mean-reversion evaluations" autoFocus>Close</button>
          </div>
        </header>
        <div className="history-panel__content">
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Read-only, analysis-only. No orders are placed by this dashboard; ENTER/EXIT are informational signals only.
          </p>
          {list?.kind === 'loading' ? <p>Loading evaluations...</p> : null}
          {list?.kind === 'failed' || list?.kind === 'malformed_response' ? <p>{list.message}</p> : null}
          {list?.kind === 'succeeded' && list.evaluations.length === 0 ? <p>No active mean-reversion strategy has been evaluated yet.</p> : null}
          {list?.kind === 'succeeded' ? (
            <div className="history-list">
              {list.evaluations.map((evaluation) => (
                <div key={evaluation.id} className={`history-row ${signalClass(evaluation.signal)}`.trim()}>
                  <strong>{evaluation.instrument} {evaluation.timeframe} | {evaluation.signal}</strong>
                  <span>
                    strategy {evaluation.strategyId.slice(0, 8)} v{evaluation.version} | ref {num(evaluation.referenceClose)} @ {evaluation.referenceCandleTime}
                  </span>
                  <span>
                    stop {num(evaluation.stopPrice)} | ATR {num(evaluation.atr)} | SMA filter {evaluation.aboveSmaFilter === null ? 'n/a' : evaluation.aboveSmaFilter ? 'above' : 'below'}
                  </span>
                  <small>
                    risk {evaluation.riskPerTradePct}% | size {evaluation.suggestedPositionSizeUnits === null ? 'account size not configured' : `${num(evaluation.suggestedPositionSizeUnits, 4)} units (${num(evaluation.suggestedRiskAmount)})`} | evaluated {evaluation.evaluatedAt}
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
