import { useEffect } from 'react';

import type { AnalysisHistoryItem, HistoryResult, ImmutableReportDetail, RunDetailResult } from '../serviceClient/localAnalysisService';

type AnalysisHistoryPanelProps = {
  open: boolean;
  history: HistoryResult | { kind: 'loading' } | null;
  detail: RunDetailResult | { kind: 'loading' } | null;
  selectedRunKey: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (runKey: string) => void;
};

const display = (value: number | null, unavailable = 'Not available') => value === null ? unavailable : value.toFixed(2);
const targets = (values: number[]) => values.length ? values.map((value) => value.toFixed(2)).join(', ') : 'Not calculated';

function HistoryRow({ item, selected, onSelect }: { item: AnalysisHistoryItem; selected: boolean; onSelect: () => void }) {
  const report = item.report;
  return (
    <button className={`history-row${selected ? ' history-row--selected' : ''}`} type="button" onClick={onSelect}>
      <strong>{report?.action ?? item.run.status}</strong>
      <span>{report?.direction ?? 'No direction'} | Score {report?.score ?? 'Not available'} | Grade {report?.grade ?? 'Not available'}</span>
      <small>{item.run.completedAt} | {report?.sourceCandleTime ?? 'Source candle unavailable'} | {item.run.status} | {report?.isActionable ? 'Actionable analysis' : 'Non-actionable analysis'}</small>
    </button>
  );
}

function Detail({ report }: { report: ImmutableReportDetail }) {
  return (
    <section className="history-detail" aria-label="Stored analysis detail">
      <strong>{report.action} | Score {report.score ?? 'Not available'} | Grade {report.grade ?? 'Not available'}</strong>
      <p>{report.primaryReason}</p>
      <dl>
        <div><dt>Entry trigger</dt><dd>{report.entryTrigger ?? 'Not available'}</dd></div>
        <div><dt>Stop</dt><dd>{display(report.stopPrice, 'Not calculated')}</dd></div>
        <div><dt>Targets</dt><dd>{targets(report.targets)}</dd></div>
        <div><dt>R:R</dt><dd>{display(report.estimatedRewardRisk)}</dd></div>
      </dl>
    </section>
  );
}

export function AnalysisHistoryPanel({ open, history, detail, selectedRunKey, onClose, onRefresh, onSelect }: AnalysisHistoryPanelProps) {
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
      <aside className="history-panel" role="dialog" aria-modal="true" aria-label="Analysis history">
        <header>
          <div><span>Local records</span><h2>Analysis history</h2></div>
          <div><button type="button" onClick={onRefresh}>Refresh</button><button type="button" onClick={onClose} aria-label="Close analysis history" autoFocus>Close</button></div>
        </header>
        <div className="history-panel__content">
          {history?.kind === 'loading' ? <p>Loading local analysis history...</p> : null}
          {history?.kind === 'empty' ? <p>No local analysis runs have been recorded.</p> : null}
          {history?.kind === 'failed' || history?.kind === 'malformed_response' ? <p>{history.message}</p> : null}
          {history?.kind === 'succeeded' ? <div className="history-list">{history.runs.map((item) => <HistoryRow key={item.run.runKey} item={item} selected={selectedRunKey === item.run.runKey} onSelect={() => onSelect(item.run.runKey)} />)}</div> : null}
          {detail?.kind === 'loading' ? <p>Loading stored analysis...</p> : null}
          {detail?.kind === 'failed' || detail?.kind === 'malformed_response' ? <p>{detail.message}</p> : null}
          {detail?.kind === 'succeeded' ? <Detail report={detail.report} /> : null}
        </div>
      </aside>
    </div>
  );
}
