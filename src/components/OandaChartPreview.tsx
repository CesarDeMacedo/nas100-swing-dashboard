import type { OandaPreviewData } from '../serviceClient/localAnalysisService';
import { FinancialChart } from './chart/FinancialChart';

type Props = { data: OandaPreviewData; loading: boolean; error: string | null; onRefresh: () => void; onBack: () => void };

export function OandaChartPreview({ data, loading, error, onRefresh, onBack }: Props) {
  const latest = data.candles.at(-1);
  return <main aria-label="OANDA H4 Chart Preview" className="dashboard-layout">
    <header className="dashboard-header"><div className="dashboard-title-block"><p className="dashboard-title-block__kicker">Market-data preview only</p><h1>OANDA H4 Chart Preview</h1><p>OANDA {data.environment.toUpperCase()} · {data.instrument} · H4</p></div><div><button type="button" onClick={onRefresh} disabled={loading}>Refresh OANDA data</button><button type="button" onClick={onBack}>Back to dashboard</button></div></header>
    <section aria-label="OANDA preview status"><p>Strategy analysis is not running.</p><p>Returned candles: {data.candles.length} · Latest data: {latest?.time ?? 'Unavailable'}</p><p>{latest ? (latest.isClosed ? 'COMPLETED H4' : 'OPEN H4 — VIEW ONLY') : 'No candles returned.'}</p>{error ? <p role="alert">{error}</p> : null}</section>
    {data.candles.length > 0 ? <FinancialChart candles={data.candles} zones={[]} priceLines={[]} accessibleLabel={`OANDA ${data.environment} H4 chart preview with ${data.candles.length} candles.`} /> : <p role="status">No OANDA candles are available for preview.</p>}
  </main>;
}
