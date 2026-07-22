import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type Time,
} from 'lightweight-charts';

import type { Candle } from '../../domain/candles';
import { formatTorontoTime } from '../../lib/format';
import {
  formatChartPrice,
  toChartCandles,
  type PriceLineModel,
  type ZoneOverlayModel,
} from './chartAdapter';
import { PriceZoneLayer } from './PriceZoneLayer';

type FinancialChartProps = {
  candles: Candle[];
  zones: ZoneOverlayModel[];
  priceLines: PriceLineModel[];
  accessibleLabel: string;
};

const lineStyleMap = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
} as const;

const formatAxisTime = (time: Time) => {
  const unixSeconds = typeof time === 'number' ? time : 0;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  }).format(new Date(unixSeconds * 1000));
};

export function FinancialChart({
  candles,
  zones,
  priceLines,
  accessibleLabel,
}: FinancialChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: '#03101b' },
        textColor: '#aeb9c1',
        fontFamily: '"Barlow Condensed", "Segoe UI", sans-serif',
        fontSize: 12,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(21, 48, 68, 0.5)' },
        horzLines: { color: 'rgba(21, 48, 68, 0.5)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#69808f', width: 1, style: LineStyle.Dashed, labelVisible: true },
        horzLine: { color: '#69808f', width: 1, style: LineStyle.Dashed, labelVisible: true },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: true,
        borderColor: '#2a3a46',
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        visible: true,
        timeVisible: true,
        secondsVisible: false,
        borderVisible: true,
        borderColor: '#2a3a46',
        rightOffset: 4,
        barSpacing: 9,
        minBarSpacing: 3,
        tickMarkFormatter: formatAxisTime,
      },
      localization: {
        priceFormatter: formatChartPrice,
        timeFormatter: (time: Time) =>
          formatTorontoTime(new Date(Number(time) * 1000).toISOString()),
      },
      handleScroll: true,
      handleScale: true,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#27c277',
      downColor: '#ff4f5e',
      wickUpColor: '#27c277',
      wickDownColor: '#ff4f5e',
      borderVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
    });

    series.setData(toChartCandles(candles));

    const zoneLayer = new PriceZoneLayer(
      zones,
      priceLines.map((line) => line.price),
    );
    series.attachPrimitive(zoneLayer);

    priceLines.forEach((line) => {
      series.createPriceLine({
        price: line.price,
        title: line.title,
        color: line.color,
        lineStyle: lineStyleMap[line.lineStyle],
        lineWidth: line.lineWidth,
        axisLabelVisible: line.axisLabelVisible,
        lineVisible: true,
      });
    });

    const visibleBars = Math.min(58, candles.length);
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, candles.length - visibleBars),
      to: candles.length + 3,
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width > 0 && height > 0) chart.resize(width, height);
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      series.detachPrimitive(zoneLayer);
      chart.remove();
    };
  }, [candles, priceLines, zones]);

  return (
    <div
      ref={containerRef}
      className="financial-chart"
      data-testid="financial-chart"
      role="img"
      aria-label={accessibleLabel}
    />
  );
}
