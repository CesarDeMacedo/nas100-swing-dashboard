import { useMemo } from 'react';

import type { SafeAnalysis } from '../../domain/analysis';
import type { DashboardState } from '../../application/buildDashboardState';
import type { CandleDataset, CandleDatasetParseResult } from '../../domain/candles';
import { formatPrice } from '../../lib/format';
import { ChartDecisionOverlay } from './ChartDecisionOverlay';
import { ChartHeader } from './ChartHeader';
import { ChartLegend } from './ChartLegend';
import { ChartStatusOverlay } from './ChartStatusOverlay';
import { FinancialChart } from './FinancialChart';
import { mapPriceLines, mapPriceZones, type ChartPalette } from './chartAdapter';

type CandlestickChartPanelProps = {
  analysis: SafeAnalysis;
  candleResult: CandleDatasetParseResult;
  dashboardState?: DashboardState;
};

const chartPalette: ChartPalette = {
  positive: '#45d483',
  negative: '#ff525c',
  warning: '#f6a20d',
  info: '#35c5ed',
  neutral: '#8795a0',
  surface: '#03101b',
  text: '#edf4f8',
};

function ValidCandlestickChart({
  analysis,
  dataset,
  dashboardState,
}: {
  analysis: SafeAnalysis;
  dataset: CandleDataset;
  dashboardState?: DashboardState;
}) {
  const chartAnalysis = dashboardState
    ? ({
        ...analysis,
        action: dashboardState.action,
        reason: dashboardState.primaryReason,
        invalidation: dashboardState.invalidationPrice ?? undefined,
        stop: dashboardState.stopPrice ?? undefined,
        targets: dashboardState.targets,
      } as SafeAnalysis)
    : analysis;
  const latestCandle = dataset.candles.at(-1);
  const zones = useMemo(() => mapPriceZones(chartAnalysis, chartPalette), [chartAnalysis]);
  const priceLines = useMemo(
    () => (latestCandle ? mapPriceLines(chartAnalysis, latestCandle.close, chartPalette) : []),
    [chartAnalysis, latestCandle],
  );

  if (!latestCandle) return null;

  const accessibleLabel = `${analysis.displayName} ${analysis.timeframe} candlestick chart. ${dataset.candles.length} ${dataset.isSynthetic ? 'synthetic' : 'saved OANDA'} candles. Latest candle ${latestCandle.isClosed ? 'completed' : 'open'} with open ${latestCandle.open}, high ${latestCandle.high}, low ${latestCandle.low}, and close ${latestCandle.close}.`;

  return (
    <section className="chart-panel" aria-label={`${analysis.instrument} H4 candlestick chart`}>
      <ChartHeader
        displayName={analysis.displayName}
        timeframe={analysis.timeframe}
        provider={analysis.dataProvider}
        freshness={analysis.dataFreshness}
        latestCandle={latestCandle}
        changePercent={analysis.changePercent}
      />
      <div className="chart-stage" data-testid="financial-chart-stage">
        <FinancialChart
          candles={dataset.candles}
          zones={zones}
          priceLines={priceLines}
          accessibleLabel={accessibleLabel}
        />
        <ChartDecisionOverlay
          action={chartAnalysis.action}
          label={dashboardState?.actionLabel}
          reason={chartAnalysis.reason}
        />
        <ChartStatusOverlay isClosed={latestCandle.isClosed} />
      </div>
      <ChartLegend
        dataset={dataset}
        latestCandle={latestCandle}
        analysisCurrentPrice={analysis.currentPrice}
      />
      <div className="sr-only" aria-label="Chart overlay values">
        {analysis.supportZones.map((zone) => (
          <span data-testid="support-zone" key={`support-${zone.low}-${zone.high}`}>
            {zone.label}: {formatPrice(zone.low)} to {formatPrice(zone.high)}
          </span>
        ))}
        {analysis.resistanceZones.map((zone) => (
          <span data-testid="resistance-zone" key={`resistance-${zone.low}-${zone.high}`}>
            {zone.label}: {formatPrice(zone.low)} to {formatPrice(zone.high)}
          </span>
        ))}
        {analysis.preferredEntryZone ? (
          <span
            data-testid="preferred-entry-zone"
            aria-label={`${analysis.preferredEntryZone.label}, ${formatPrice(analysis.preferredEntryZone.low)} to ${formatPrice(analysis.preferredEntryZone.high)}`}
          />
        ) : null}
        <span data-testid="current-price-marker">{formatPrice(analysis.currentPrice)}</span>
        {chartAnalysis.stop !== undefined ? <span>Stop {formatPrice(chartAnalysis.stop)}</span> : null}
        {chartAnalysis.targets.map((target, index) => (
          <span key={`target-summary-${target}`}>
            Target {index + 1} {formatPrice(target)}
          </span>
        ))}
      </div>
      <p className="sr-only" data-testid="latest-candle-summary">
        {accessibleLabel}
      </p>
    </section>
  );
}

export function CandlestickChartPanel({ analysis, candleResult, dashboardState }: CandlestickChartPanelProps) {
  if (!candleResult.success) {
    return (
      <section className="chart-panel" aria-label={`${analysis.instrument} H4 chart unavailable`}>
        <ChartHeader
          displayName={analysis.displayName}
          timeframe={analysis.timeframe}
          provider={analysis.dataProvider}
          freshness={analysis.dataFreshness}
          changePercent={analysis.changePercent}
        />
        <div className="chart-data-error" data-testid="chart-error-state" role="status">
          <span>Chart unavailable</span>
          <strong>Mock candle data failed validation</strong>
          <p>The dashboard report remains visible, but no OHLC chart is shown.</p>
        </div>
      </section>
    );
  }

  return (
    <ValidCandlestickChart
      analysis={analysis}
      dataset={candleResult.dataset}
      dashboardState={dashboardState}
    />
  );
}
