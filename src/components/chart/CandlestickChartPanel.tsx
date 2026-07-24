import { useMemo, useRef, useState } from 'react';

import type { SafeAnalysis } from '../../domain/analysis';
import type { DashboardState } from '../../application/buildDashboardState';
import type { CandleDataset, CandleDatasetParseResult } from '../../domain/candles';
import { formatPrice } from '../../lib/format';
import { ChartDecisionOverlay } from './ChartDecisionOverlay';
import { ChartHeader } from './ChartHeader';
import { ChartLegend } from './ChartLegend';
import { ChartStatusOverlay } from './ChartStatusOverlay';
import { FinancialChart, type FinancialChartHandle } from './FinancialChart';
import { mapPriceLines, mapPriceZones, selectVisibleSavedLevels, type ChartPalette } from './chartAdapter';

const downloadChartPng = (canvas: HTMLCanvasElement, instrument: string) => {
  const link = document.createElement('a');
  link.download = `${instrument.replace(/[^a-z0-9]+/gi, '-')}-h4-chart-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
};

type CandlestickChartPanelProps = {
  analysis: SafeAnalysis;
  candleResult: CandleDatasetParseResult;
  dashboardState?: DashboardState;
  savedMetadata?: { provenance: string; sourceTime: string | null; latestPrice: number | null; liveStatus: string | null };
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
  savedMetadata,
}: {
  analysis: SafeAnalysis;
  dataset: CandleDataset;
  dashboardState?: DashboardState;
  savedMetadata?: { provenance: string; sourceTime: string | null; latestPrice: number | null; liveStatus: string | null };
}) {
  const [resetKey, setResetKey] = useState(0);
  const chartHandleRef = useRef<FinancialChartHandle>(null);
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
  const isSavedOanda = !dataset.isSynthetic && analysis.dataProvider === 'OANDA v20';
  const selectedLevels = isSavedOanda ? selectVisibleSavedLevels(chartAnalysis) : { supports: chartAnalysis.supportZones, resistances: chartAnalysis.resistanceZones, hiddenCount: 0 };
  const visibleSupports = selectedLevels.supports;
  const visibleResistances = selectedLevels.resistances;
  const visibleAnalysis = { ...chartAnalysis, supportZones: visibleSupports, resistanceZones: visibleResistances };
  const hiddenLevelCount = selectedLevels.hiddenCount;
  const latestCandle = dataset.candles.at(-1);
  const zones = useMemo(() => mapPriceZones(visibleAnalysis, chartPalette), [visibleAnalysis]);
  const priceLines = useMemo(
    () => (latestCandle ? mapPriceLines(visibleAnalysis, latestCandle.close, chartPalette) : []),
    [visibleAnalysis, latestCandle],
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
        onResetView={() => setResetKey((key) => key + 1)}
        onExportPng={() => {
          const canvas = chartHandleRef.current?.exportPng();
          if (canvas) downloadChartPng(canvas, analysis.instrument);
        }}
        savedMetadata={savedMetadata}
      />
      <p className="chart-navigation-hint">Scroll to zoom · Drag to pan · Double-click scale to reset</p>
      <div className="chart-stage" data-testid="financial-chart-stage">
        <FinancialChart
          ref={chartHandleRef}
          candles={dataset.candles}
          zones={zones}
          priceLines={priceLines}
          accessibleLabel={accessibleLabel}
          resetKey={resetKey}
          chartIdentity={dataset.datasetId}
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
        hiddenLevelCount={hiddenLevelCount}
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

export function CandlestickChartPanel({ analysis, candleResult, dashboardState, savedMetadata }: CandlestickChartPanelProps) {
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
      savedMetadata={savedMetadata}
    />
  );
}
