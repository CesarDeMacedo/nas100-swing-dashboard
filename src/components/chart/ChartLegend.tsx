import type { Candle, CandleDataset } from '../../domain/candles';
import { formatPrice, formatTorontoTime } from '../../lib/format';

type ChartLegendProps = {
  dataset: CandleDataset;
  latestCandle: Candle;
  analysisCurrentPrice: number;
  hiddenLevelCount?: number;
};

export function ChartLegend({ dataset, latestCandle, analysisCurrentPrice, hiddenLevelCount = 0 }: ChartLegendProps) {
  const priceMatches = Math.abs(analysisCurrentPrice - latestCandle.close) < 0.05;

  return (
    <div className="chart-legend" aria-label="Chart data summary">
      <span>{dataset.candles.length} {dataset.isSynthetic ? 'synthetic' : 'saved OANDA'} H4 candles</span>
      {hiddenLevelCount > 0 ? <span data-testid="hidden-level-count">+ {hiddenLevelCount} additional saved levels</span> : null}
      <span>{formatTorontoTime(dataset.candles[0]?.time ?? latestCandle.time)}</span>
      <span>to {formatTorontoTime(latestCandle.time)}</span>
      <span>
        {priceMatches
          ? `Analysis price matches completed close at ${formatPrice(analysisCurrentPrice)}`
          : `Analysis ${formatPrice(analysisCurrentPrice)} / completed close ${formatPrice(latestCandle.close)}`}
      </span>
      <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
        Charting by TradingView
      </a>
    </div>
  );
}
