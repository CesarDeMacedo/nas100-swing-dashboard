import type {
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';

import type { ZoneOverlayModel } from './chartAdapter';

const LABEL_FONT = '500 12px "Barlow Condensed", "Segoe UI", sans-serif';

export class PriceZoneLayer implements ISeriesPrimitive<Time> {
  private parameters?: SeriesAttachedParameter<Time>;

  constructor(
    private readonly zones: ZoneOverlayModel[],
    private readonly additionalPrices: number[] = [],
    /** Time of the most recent candle. Labels anchor just to the right of it (genuinely
     * empty space at any zoom/pan) instead of a fixed pane-relative offset, which used to
     * land on top of the last several candles whenever they filled that assumed margin —
     * the "pan left to read the label" complaint. */
    private readonly lastCandleTime?: Time,
  ) {}

  attached(parameters: SeriesAttachedParameter<Time>) {
    this.parameters = parameters;
    parameters.requestUpdate();
  }

  detached() {
    this.parameters = undefined;
  }

  autoscaleInfo() {
    const prices = [
      ...this.zones.flatMap((zone) => [zone.low, zone.high]),
      ...this.additionalPrices,
    ];

    if (prices.length === 0) return null;

    return {
      priceRange: {
        minValue: Math.min(...prices),
        maxValue: Math.max(...prices),
      },
    };
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [
      {
        zOrder: () => 'bottom',
        renderer: () => ({
          draw: (target) => {
            target.useMediaCoordinateSpace(({ context, mediaSize }) => {
              const series = this.parameters?.series;
              if (!series) return;

              this.zones.forEach((zone) => {
                const highY = series.priceToCoordinate(zone.high);
                const lowY = series.priceToCoordinate(zone.low);
                if (highY === null || lowY === null) return;

                const top = Math.min(highY, lowY);
                const height = Math.max(2, Math.abs(lowY - highY));
                context.save();
                context.fillStyle = zone.fillColor;
                context.fillRect(0, top, mediaSize.width, height);
                context.strokeStyle = zone.borderColor;
                context.lineWidth = 1;
                context.setLineDash(zone.emphasis === 'entry' ? [6, 4] : []);
                context.strokeRect(0.5, top + 0.5, mediaSize.width - 1, Math.max(1, height - 1));
                context.restore();
              });
            });
          },
        }),
      },
      {
        zOrder: () => 'top',
        renderer: () => ({
          draw: (target) => {
            target.useMediaCoordinateSpace(({ context, mediaSize }) => {
              const series = this.parameters?.series;
              const chart = this.parameters?.chart;
              if (!series) return;

              // Genuinely empty space just right of the last candle, at whatever the
              // current zoom/pan happens to be. Falls back to a fixed right-edge margin
              // only when that coordinate can't be resolved (e.g. the last candle has been
              // panned off-screen).
              const lastCandleX = this.lastCandleTime !== undefined
                ? chart?.timeScale().timeToCoordinate(this.lastCandleTime) ?? null
                : null;

              this.zones.forEach((zone) => {
                const highY = series.priceToCoordinate(zone.high);
                const lowY = series.priceToCoordinate(zone.low);
                if (highY === null || lowY === null) return;

                const centerY = (highY + lowY) / 2;
                const label = `${zone.label}  ${zone.formattedRange}`;
                context.save();
                context.font = LABEL_FONT;
                const textWidth = context.measureText(label).width;
                const labelX = lastCandleX !== null
                  ? Math.min(Math.max(8, lastCandleX + 10), mediaSize.width - textWidth - 8)
                  : Math.max(8, mediaSize.width - textWidth - 112);
                context.fillStyle = 'rgba(3, 16, 27, 0.82)';
                context.fillRect(labelX - 5, centerY - 9, textWidth + 10, 18);
                context.fillStyle = zone.textColor;
                context.textBaseline = 'middle';
                context.fillText(label, labelX, centerY);
                context.restore();
              });
            });
          },
        }),
      },
    ];
  }
}
