import type { Candle, CandleDataset } from '../../domain/candles';
import { formatPrice, formatTorontoTime } from '../../lib/format';

type ChartLegendProps = {
  dataset: CandleDataset;
  latestCandle: Candle;
  analysisCurrentPrice: number;
};

export function ChartLegend({ dataset, latestCandle, analysisCurrentPrice }: ChartLegendProps) {
  const priceMatches = Math.abs(analysisCurrentPrice - latestCandle.close) < 0.05;

  return (
    <div className="chart-legend" aria-label="Chart data summary">
      <span>{dataset.candles.length} synthetic H4 candles</span>
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
