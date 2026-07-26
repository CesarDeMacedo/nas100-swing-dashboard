import { useEffect, useMemo, useState } from 'react';

import type { BacktestListResult, BacktestReportResult, BacktestRunSummary } from '../serviceClient/localAnalysisService';
import { RunBacktestControl } from './RunBacktestControl';

type BacktestResultsPanelProps = {
  open: boolean;
  list: BacktestListResult | { kind: 'loading' } | null;
  detail: BacktestReportResult | { kind: 'loading' } | null;
  selectedRunId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (runId: string) => void;
};

const matchesFilter = (run: BacktestRunSummary, filter: string) => {
  if (!filter) return true;
  const haystack = `${run.instrument} ${run.strategyConfigId} ${run.status}`.toLowerCase();
  return haystack.includes(filter.toLowerCase());
};

const pct = (value: number | null) => (value === null ? 'Not available' : `${(value * 100).toFixed(1)}%`);
const r = (value: number) => `${value.toFixed(2)}R`;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A simple dependency-free CSS bar chart, not lightweight-charts: lightweight-charts is a
 * time-series library (its series plot value-over-continuous-time), which is a poor fit for
 * categorical hour-of-day/weekday buckets — fabricating fake timestamps for 24 discrete hours
 * would be a worse solution than a handful of styled divs. */
function BarBreakdown({ entries, labelOf }: { entries: { signalCount: number; winRate: number | null }[]; labelOf: (index: number) => string }) {
  const maxCount = Math.max(1, ...entries.map((entry) => entry.signalCount));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 96 }}>
      {entries.map((entry, index) => (
        <div key={index} title={`${labelOf(index)}: ${entry.signalCount} signals, ${pct(entry.winRate)} win rate`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ width: '100%', height: `${(entry.signalCount / maxCount) * 72}px`, background: entry.winRate === null ? 'var(--border-muted)' : entry.winRate >= 0.5 ? 'var(--positive)' : 'var(--negative)', borderRadius: 2 }} />
          <small style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{labelOf(index)}</small>
        </div>
      ))}
    </div>
  );
}

export function BacktestResultsPanel({ open, list, detail, selectedRunId, onClose, onRefresh, onSelect }: BacktestResultsPanelProps) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const filteredRuns = useMemo(() => (list?.kind === 'succeeded' ? list.backtests.filter((run) => matchesFilter(run, filter)) : []), [list, filter]);

  if (!open) return null;
  return (
    <div className="history-overlay" role="presentation">
      <aside className="history-panel" role="dialog" aria-modal="true" aria-label="Backtest results">
        <header>
          <div><span>Local records</span><h2>Backtest results</h2></div>
          <div><button type="button" onClick={onRefresh}>Refresh</button><button type="button" onClick={onClose} aria-label="Close backtest results" autoFocus>Close</button></div>
        </header>
        {list?.kind === 'succeeded' ? (
          <div className="history-panel__controls">
            <input type="search" aria-label="Filter backtest runs" placeholder="Filter by instrument, strategy, or status" value={filter} onChange={(event) => setFilter(event.target.value)} />
          </div>
        ) : null}
        <div className="history-panel__content">
          <details>
            <summary>Run backtest</summary>
            <RunBacktestControl />
          </details>
          {list?.kind === 'loading' ? <p>Loading backtest runs...</p> : null}
          {list?.kind === 'failed' || list?.kind === 'malformed_response' ? <p>{list.message}</p> : null}
          {list?.kind === 'succeeded' && filteredRuns.length === 0 ? <p>No backtest runs match this filter. Run one via the CLI (see "Run backtest").</p> : null}
          {list?.kind === 'succeeded' ? (
            <div className="history-list">
              {filteredRuns.map((run) => (
                <button key={run.id} className={`history-row${selectedRunId === run.id ? ' history-row--selected' : ''}`} type="button" onClick={() => onSelect(run.id)}>
                  <strong>{run.instrument} | {run.status}</strong>
                  <span>{run.rangeStart} → {run.rangeEnd}</span>
                  <small>{run.strategyConfigId} | {run.frameCount ?? 0} frames evaluated</small>
                </button>
              ))}
            </div>
          ) : null}

          {detail?.kind === 'loading' ? <p>Loading backtest report...</p> : null}
          {detail?.kind === 'not_found' ? <p>This backtest run no longer exists.</p> : null}
          {detail?.kind === 'failed' || detail?.kind === 'malformed_response' ? <p>{detail.message}</p> : null}
          {detail?.kind === 'succeeded' ? (
            <section className="history-detail" aria-label="Backtest report">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                <div className="metric-item"><div><span>Win rate</span><strong>{pct(detail.report.summary.winRate)}</strong></div></div>
                <div className="metric-item"><div><span>Avg planned R:R</span><strong>{r(detail.report.summary.avgRewardRisk)}</strong></div></div>
                <div className="metric-item"><div><span>Avg realized R:R (wins)</span><strong>{detail.report.summary.avgWinRewardRisk === null ? 'Not available' : r(detail.report.summary.avgWinRewardRisk)}</strong></div></div>
                <div className="metric-item"><div><span>Expectancy</span><strong>{r(detail.report.summary.expectancy)}</strong></div></div>
                <div className="metric-item"><div><span>Signals</span><strong>{detail.report.summary.signalCount} ({detail.report.summary.winCount}W / {detail.report.summary.lossCount}L / {detail.report.summary.cancelledCount} cancelled / {detail.report.summary.unresolvedCount} unresolved)</strong></div></div>
              </div>
              <p>Breakdown by hour of day (America/Toronto)</p>
              <BarBreakdown entries={detail.report.breakdownByHour} labelOf={(index) => String(detail.report.breakdownByHour[index]!.hour)} />
              <p style={{ marginTop: 16 }}>Breakdown by weekday</p>
              <BarBreakdown entries={detail.report.breakdownByWeekday} labelOf={(index) => WEEKDAY_NAMES[detail.report.breakdownByWeekday[index]!.weekday]!} />
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
