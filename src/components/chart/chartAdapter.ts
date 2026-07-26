import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

import type { Candle } from '../../domain/candles';
import type { SafeAnalysis } from '../../domain/analysis';
import { formatPrice } from '../../lib/format';
import type { MeanReversionEvaluation } from '../../serviceClient/localAnalysisService';

/** Deliberately outside ChartPalette: the mean-reversion overlay is a visually distinct system
 * from the pipeline's own entry/invalidation/stop/target lines (drawn from `mapPriceLines`) —
 * a violet neither `positive`/`negative`/`warning`/`info`/`neutral` uses, so the two strategies'
 * lines never get mistaken for one another on the same H4 chart. */
const MR_ENTRY_COLOR = '#b388ff';
const MR_STOP_COLOR = '#e56399';

export type ChartPalette = {
  positive: string;
  negative: string;
  warning: string;
  info: string;
  neutral: string;
  surface: string;
  text: string;
};

export type ZoneOverlayModel = {
  id: string;
  low: number;
  high: number;
  label: string;
  formattedRange: string;
  fillColor: string;
  borderColor: string;
  textColor: string;
  emphasis: 'support' | 'resistance' | 'entry';
};

export type PriceLineModel = {
  id: string;
  price: number;
  title: string;
  color: string;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  axisLabelVisible: boolean;
  lineWidth: 1 | 2;
};

export function selectVisibleSavedLevels(analysis: SafeAnalysis, limit = 3) {
  const supports = [...analysis.supportZones]
    .filter((zone) => zone.high <= analysis.currentPrice)
    .sort((a, b) => b.high - a.high)
    .slice(0, limit);
  const resistances = [...analysis.resistanceZones]
    .filter((zone) => zone.low >= analysis.currentPrice)
    .sort((a, b) => a.low - b.low)
    .slice(0, limit);
  return {
    supports,
    resistances,
    hiddenCount:
      analysis.supportZones.length +
      analysis.resistanceZones.length -
      supports.length -
      resistances.length,
  };
}

export const toUtcTimestamp = (timestamp: string) =>
  Math.floor(Date.parse(timestamp) / 1000) as UTCTimestamp;

export const toChartCandles = (candles: Candle[]): CandlestickData<UTCTimestamp>[] =>
  candles.map(({ time, open, high, low, close }) => ({
    time: toUtcTimestamp(time),
    open,
    high,
    low,
    close,
  }));

export const formatChartPrice = (price: number) => formatPrice(price, 1);

export function mapPriceZones(analysis: SafeAnalysis, palette: ChartPalette): ZoneOverlayModel[] {
  const formatRange = (low: number, high: number) => `${formatPrice(low)} - ${formatPrice(high)}`;

  const supportZones = analysis.supportZones.map((zone, index) => ({
    id: `support-${index}-${zone.low}-${zone.high}`,
    low: zone.low,
    high: zone.high,
    label: zone.label,
    formattedRange: formatRange(zone.low, zone.high),
    fillColor: 'rgba(37, 164, 94, 0.15)',
    borderColor: palette.positive,
    textColor: '#81e5a8',
    emphasis: 'support' as const,
  }));

  const resistanceZones = analysis.resistanceZones.map((zone, index) => ({
    id: `resistance-${index}-${zone.low}-${zone.high}`,
    low: zone.low,
    high: zone.high,
    label: zone.label,
    formattedRange: formatRange(zone.low, zone.high),
    fillColor: 'rgba(220, 58, 72, 0.14)',
    borderColor: palette.negative,
    textColor: '#ff8088',
    emphasis: 'resistance' as const,
  }));

  const entryZone = analysis.preferredEntryZone
    ? [
        {
          id: `entry-${analysis.preferredEntryZone.low}-${analysis.preferredEntryZone.high}`,
          low: analysis.preferredEntryZone.low,
          high: analysis.preferredEntryZone.high,
          label: analysis.preferredEntryZone.label,
          formattedRange: formatRange(
            analysis.preferredEntryZone.low,
            analysis.preferredEntryZone.high,
          ),
          fillColor: 'rgba(69, 212, 131, 0.08)',
          borderColor: palette.warning,
          textColor: palette.warning,
          emphasis: 'entry' as const,
        },
      ]
    : [];

  return [...supportZones, ...resistanceZones, ...entryZone];
}

export function mapPriceLines(
  analysis: SafeAnalysis,
  finalCandleClose: number,
  palette: ChartPalette,
): PriceLineModel[] {
  const lines: PriceLineModel[] = [
    {
      id: 'analysis-current-price',
      price: analysis.currentPrice,
      title: 'Analysis price',
      color: palette.warning,
      lineStyle: 'solid',
      axisLabelVisible: true,
      lineWidth: 2,
    },
  ];

  if (Math.abs(analysis.currentPrice - finalCandleClose) >= 0.05) {
    lines.push({
      id: 'completed-candle-close',
      price: finalCandleClose,
      title: 'Completed close',
      color: palette.neutral,
      lineStyle: 'dotted',
      axisLabelVisible: true,
      lineWidth: 1,
    });
  }

  if (analysis.invalidation !== undefined) {
    lines.push({
      id: 'invalidation',
      price: analysis.invalidation,
      title: 'Invalidation',
      color: palette.negative,
      lineStyle: 'dashed',
      axisLabelVisible: true,
      lineWidth: 1,
    });
  }

  if (analysis.stop !== undefined) {
    lines.push({
      id: 'stop',
      price: analysis.stop,
      title: 'Stop',
      color: '#ff6f76',
      lineStyle: 'dotted',
      axisLabelVisible: true,
      lineWidth: 1,
    });
  }

  analysis.targets.forEach((target, index) => {
    lines.push({
      id: `target-${index + 1}`,
      price: target,
      title: `Target ${index + 1}`,
      color: palette.info,
      lineStyle: 'dashed',
      axisLabelVisible: true,
      lineWidth: 1,
    });
  });

  return lines;
}

/** Draws the live mean-reversion strategy's entry reference and stop directly on the H4 chart,
 * only while a position is actually tracked (ENTER/HOLD) — FLAT/EXIT would otherwise leave a
 * stale entry/stop line pointing at a trade that's already closed. `null`/`undefined` (no
 * active MR strategy, e.g. the mock dashboard) draws nothing. */
export function mapMeanReversionPriceLines(
  evaluation: MeanReversionEvaluation | null | undefined,
): PriceLineModel[] {
  if (!evaluation || (evaluation.signal !== 'ENTER' && evaluation.signal !== 'HOLD')) return [];

  const lines: PriceLineModel[] = [
    {
      id: 'mr-entry',
      price: evaluation.referenceClose,
      title: 'MR entry',
      color: MR_ENTRY_COLOR,
      lineStyle: 'dashed',
      axisLabelVisible: true,
      lineWidth: 2,
    },
  ];

  if (evaluation.stopPrice !== null) {
    lines.push({
      id: 'mr-stop',
      price: evaluation.stopPrice,
      title: 'MR stop',
      color: MR_STOP_COLOR,
      lineStyle: 'dashed',
      axisLabelVisible: true,
      lineWidth: 1,
    });
  }

  return lines;
}
