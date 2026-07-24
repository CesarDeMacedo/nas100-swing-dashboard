import type { OandaPreviewData } from '../serviceClient/localAnalysisService';
import { FinancialChart } from './chart/FinancialChart';

type Props = { data: OandaPreviewData; loading: boolean; error: string | null; onRefresh: () => void; onBack: () => void };

export function OandaChartPreview({ data, loading, error, onRefresh, onBack }: Props) {
  const latest = data.candles.at(-1);
  return (
    <main aria-label="OANDA H4 Chart Preview" className="oanda-preview">
      <header className="dashboard-header">
        <div className="dashboard-title-block">
          <p className="dashboard-title-block__kicker">Market-data preview only</p>
          <h1>OANDA H4 Chart Preview</h1>
          <p>OANDA {data.environment.toUpperCase()} · {data.instrument} · H4</p>
        </div>
        <div className="dashboard-header__actions">
          <button type="button" className="header-action-button" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh OANDA data'}</button>
          <button type="button" className="header-action-button" onClick={onBack}>Back to dashboard</button>
        </div>
      </header>
      <p className="oanda-preview__status" aria-label="OANDA preview status">
        Strategy analysis is not running. Returned candles: {data.candles.length} · Latest data: {latest?.time ?? 'Unavailable'} · {latest ? (latest.isClosed ? 'COMPLETED H4' : 'OPEN H4 — VIEW ONLY') : 'No candles returned.'}
      </p>
      {error ? <p role="alert" className="oanda-preview__error">{error}</p> : null}
      {data.candles.length > 0 ? (
        <div className="chart-stage oanda-preview__stage" data-testid="oanda-preview-stage">
          <FinancialChart candles={data.candles} zones={[]} priceLines={[]} accessibleLabel={`OANDA ${data.environment} H4 chart preview with ${data.candles.length} candles.`} />
        </div>
      ) : <p role="status">No OANDA candles are available for preview.</p>}
    </main>
  );
}
