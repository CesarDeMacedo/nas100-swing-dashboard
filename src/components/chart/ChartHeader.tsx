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
};

export function ChartHeader({
  displayName,
  timeframe,
  provider,
  freshness,
  latestCandle,
  changePercent,
}: ChartHeaderProps) {
  return (
    <header className="chart-header">
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
      <DataFreshnessBadge freshness={freshness} provider={provider} />
    </header>
  );
}
