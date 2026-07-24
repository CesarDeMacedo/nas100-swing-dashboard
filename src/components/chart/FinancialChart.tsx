import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type Time,
  type IPriceLine,
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
  resetKey?: number;
  chartIdentity?: string;
};

type ChartSeries = { setData: (data: ReturnType<typeof toChartCandles>) => void; attachPrimitive: (primitive: PriceZoneLayer) => void; detachPrimitive: (primitive: PriceZoneLayer) => void; createPriceLine: (options: Record<string, unknown>) => IPriceLine; removePriceLine: (line: IPriceLine) => void };
type ChartInstance = { timeScale: () => { setVisibleLogicalRange: (range: { from: number; to: number }) => void; fitContent: () => void }; addSeries: (...args: unknown[]) => ChartSeries; resize: (width: number, height: number) => void; remove: () => void; takeScreenshot: () => HTMLCanvasElement };

export type FinancialChartHandle = { exportPng: () => HTMLCanvasElement | null };

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

export const chartNavigationOptions = {
  handleScroll: { pressedMouseMove: true, mouseWheel: false, horzTouchDrag: true, vertTouchDrag: true },
  handleScale: { mouseWheel: true, axisPressedMouseMove: true, axisDoubleClickReset: true, pinch: true },
} as const;

export const FinancialChart = forwardRef<FinancialChartHandle, FinancialChartProps>(function FinancialChart({
  candles,
  zones,
  priceLines,
  accessibleLabel,
  resetKey = 0,
  chartIdentity = 'default',
}, exportRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const seriesRef = useRef<ChartSeries | null>(null);
  const zoneLayerRef = useRef<PriceZoneLayer | null>(null);
  const priceLineRefs = useRef<IPriceLine[]>([]);

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
      ...chartNavigationOptions,
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

    chartRef.current = chart as unknown as ChartInstance;
    seriesRef.current = series as unknown as ChartSeries;
    const applyOverlays = () => {
      if (zoneLayerRef.current) series.detachPrimitive(zoneLayerRef.current);
      priceLineRefs.current.forEach((line) => series.removePriceLine(line));
      const zoneLayer = new PriceZoneLayer(zones, priceLines.map((line) => line.price));
      zoneLayerRef.current = zoneLayer;
      series.attachPrimitive(zoneLayer);
      priceLineRefs.current = priceLines.map((line) => series.createPriceLine({
        price: line.price,
        title: line.title,
        color: line.color,
        lineStyle: lineStyleMap[line.lineStyle],
        lineWidth: line.lineWidth,
        axisLabelVisible: line.axisLabelVisible,
        lineVisible: true,
      }));
    };
    series.setData(toChartCandles(candles));
    applyOverlays();

    const visibleBars = Math.min(58, candles.length);
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - visibleBars), to: candles.length + 3 });

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
      if (zoneLayerRef.current) series.detachPrimitive(zoneLayerRef.current);
      priceLineRefs.current.forEach((line) => series.removePriceLine(line));
      chart.remove();
      chartRef.current = null; seriesRef.current = null; zoneLayerRef.current = null; priceLineRefs.current = [];
    };
  }, [chartIdentity]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    series.setData(toChartCandles(candles));
    if (zoneLayerRef.current) series.detachPrimitive(zoneLayerRef.current);
    priceLineRefs.current.forEach((line) => series.removePriceLine(line));
    const zoneLayer = new PriceZoneLayer(zones, priceLines.map((line) => line.price));
    zoneLayerRef.current = zoneLayer;
    series.attachPrimitive(zoneLayer);
    priceLineRefs.current = priceLines.map((line) => series.createPriceLine({ price: line.price, title: line.title, color: line.color, lineStyle: lineStyleMap[line.lineStyle], lineWidth: line.lineWidth, axisLabelVisible: line.axisLabelVisible, lineVisible: true }));
  }, [candles, zones, priceLines]);

  const previousResetKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey === previousResetKey.current) return;
    previousResetKey.current = resetKey;
    chartRef.current?.timeScale().fitContent();
  }, [resetKey]);

  useImperativeHandle(exportRef, () => ({
    exportPng: () => chartRef.current?.takeScreenshot() ?? null,
  }), []);

  return (
    <div
      ref={containerRef}
      className="financial-chart"
      data-testid="financial-chart"
      role="img"
      aria-label={accessibleLabel}
    />
  );
});
