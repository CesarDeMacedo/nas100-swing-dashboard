import type { DataFreshness } from '../../domain/analysis';
import type { Candle } from '../../domain/candles';
import { formatPercent, formatPrice } from '../../lib/format';
import { DataFreshnessBadge } from '../DataFreshnessBadge';

type ChartHeaderProps = {
  displayName: string;
  timeframe: string;
  provider: string;
  freshness: DataFreshness;
  latestCandle?: Candle;
  changePercent: number;
  onResetView?: () => void;
  onExportPng?: () => void;
  savedMetadata?: { provenance: string; sourceTime: string | null; latestPrice: number | null; liveStatus: string | null };
};

export function ChartHeader({
  displayName,
  timeframe,
  provider,
  freshness,
  latestCandle,
  changePercent,
  onResetView,
  onExportPng,
  savedMetadata,
}: ChartHeaderProps) {
  return (
    <header className="chart-header">
      <div className="chart-header__row">
        <div className="chart-header__identity">
          <strong>{displayName}</strong>
          <span>{timeframe}</span>
          <span>{provider.toUpperCase()}</span>
        </div>
        <div className="chart-header__ohlc" aria-label="Latest candle OHLC">
          {latestCandle ? (
            <>
              <span>O {formatPrice(latestCandle.open)}</span>
              <span>H {formatPrice(latestCandle.high)}</span>
              <span>L {formatPrice(latestCandle.low)}</span>
              <span>C {formatPrice(latestCandle.close)}</span>
            </>
          ) : (
            <span>OHLC unavailable</span>
          )}
          <strong className={changePercent >= 0 ? 'text-positive' : 'text-negative'}>
            {formatPercent(changePercent)}
          </strong>
        </div>
        <div className="chart-header__controls"><DataFreshnessBadge freshness={freshness} provider={provider} />{onResetView ? <button type="button" onClick={onResetView}>Reset view</button> : null}{onExportPng ? <button type="button" onClick={onExportPng}>Export PNG</button> : null}</div>
      </div>
      {savedMetadata ? <div className="chart-header__saved-meta" role="status"><strong>{savedMetadata.provenance} — SAVED ANALYSIS</strong><span>Saved H4: {savedMetadata.sourceTime ?? 'Unavailable'}</span><span>OPEN H4 — NOT USED FOR DECISIONS{savedMetadata.liveStatus ? ` · ${savedMetadata.liveStatus.toUpperCase()}` : ''}</span>{savedMetadata.latestPrice !== null ? <span>Latest observed midpoint: {savedMetadata.latestPrice.toLocaleString()}</span> : null}</div> : null}
    </header>
  );
}
