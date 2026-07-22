import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

import type { Candle } from '../../domain/candles';
import type { SafeAnalysis } from '../../domain/analysis';
import { formatPrice } from '../../lib/format';

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
