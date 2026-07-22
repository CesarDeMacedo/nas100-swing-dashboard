import type { Candle } from '../schemas/candles';
import type {
  CandleStatus,
  DailyRegime,
  DailyRegimeClassification,
  H4Structure,
  H4StructureClassification,
} from '../schemas/enums';
import { classifyDailyRegime, type DailyRegimeResult } from './dailyRegime';
import { classifyH4Structure, type H4StructureResult } from './h4Structure';
import {
  calculateLatestIndicatorSnapshot,
  type FixtureIndicatorValues,
  type LatestIndicatorSnapshot,
} from './indicators';

export type TechnicalContextStatus = 'ready' | 'partial' | 'unavailable';

export type TechnicalContext = {
  sourceCandleTime: string | null;
  latestCandleStatus: CandleStatus;
  indicatorSnapshot: LatestIndicatorSnapshot;
  dailyRegime: DailyRegimeResult;
  h4Structure: H4StructureResult;
  canonicalDailyRegime: DailyRegimeClassification;
  canonicalH4Structure: H4StructureClassification;
  legacyDailyRegime: DailyRegime | null;
  legacyH4Structure: H4Structure | null;
  status: TechnicalContextStatus;
  warnings: string[];
  missingInputs: string[];
};

export type TechnicalContextFixtureComparison = {
  dailyRegime: { calculated: DailyRegime | null; fixture: unknown; matches: boolean };
  h4Structure: { calculated: H4Structure | null; fixture: unknown; matches: boolean };
  indicators: Record<
    keyof FixtureIndicatorValues,
    { calculated: number | null; fixture: number | undefined; difference: number | null }
  >;
};

const DAILY_REGIME_LEGACY_MAP: Record<Exclude<DailyRegimeClassification, 'unavailable'>, DailyRegime> = {
  strong_bullish: 'BULLISH',
  defensive_bullish: 'DEFENSIVE_BULLISH',
  neutral: 'NEUTRAL',
  defensive_bearish: 'DEFENSIVE_BEARISH',
  strong_bearish: 'BEARISH',
};

const H4_STRUCTURE_LEGACY_MAP: Record<Exclude<H4StructureClassification, 'unavailable'>, H4Structure> = {
  bullish_trend: 'BULLISH_CONTINUATION',
  bearish_trend: 'BEARISH_CONTINUATION',
  bullish_pullback: 'PULLBACK_FORMING',
  bearish_pullback: 'PULLBACK_FORMING',
  consolidation: 'RANGE',
  bullish_breakout: 'BREAKOUT',
  bearish_breakout: 'BREAKDOWN',
  bullish_reversal_attempt: 'UNKNOWN',
  bearish_reversal_attempt: 'UNKNOWN',
};

// Legacy report enums have no safe equivalent for unavailable canonical classifications.
export function mapCanonicalDailyRegimeToLegacy(value: unknown): DailyRegime | null {
  if (typeof value !== 'string' || value === 'unavailable') return null;
  return DAILY_REGIME_LEGACY_MAP[value as Exclude<DailyRegimeClassification, 'unavailable'>] ?? null;
}

export function mapCanonicalH4StructureToLegacy(value: unknown): H4Structure | null {
  if (typeof value !== 'string' || value === 'unavailable') return null;
  return H4_STRUCTURE_LEGACY_MAP[value as Exclude<H4StructureClassification, 'unavailable'>] ?? null;
}

const completedCandles = (candles: readonly Candle[]) => candles.filter((candle) => candle.isClosed);

const indicatorKeys = [
  'ema5',
  'ema8',
  'ema13',
  'ema20',
  'ema21',
  'ema50',
  'ema200',
  'rsi14',
  'atr14',
  'distanceFromEma20Atr',
] as const;

export function buildTechnicalContext(candles: readonly Candle[]): TechnicalContext {
  const completed = completedCandles(candles);
  const latestCompleted = completed.at(-1);
  const latestCandle = candles.at(-1);
  const latestCandleStatus: CandleStatus = !latestCandle
    ? 'UNKNOWN'
    : latestCandle.isClosed
      ? 'COMPLETED'
      : 'OPEN';
  const currentPrice = latestCompleted?.close ?? Number.NaN;
  const indicatorSnapshot = calculateLatestIndicatorSnapshot(completed, currentPrice);
  const dailyRegime = classifyDailyRegime(completed, currentPrice);
  const h4Structure = classifyH4Structure(completed);
  const missingInputs = [...new Set([...dailyRegime.missingInputs, ...h4Structure.missingInputs])];
  const warnings = [
    ...(indicatorSnapshot.ema200.status !== 'available' ? ['EMA200 is unavailable'] : []),
    ...(dailyRegime.status === 'unavailable' ? ['Daily regime is unavailable'] : []),
    ...(h4Structure.status === 'unavailable' ? ['H4 structure is unavailable'] : []),
    ...(latestCandleStatus === 'OPEN' ? ['Latest candle is open and excluded from technical context'] : []),
    ...(latestCandleStatus === 'UNKNOWN' ? ['Latest candle is missing'] : []),
    ...(missingInputs.length > 0 ? ['Required technical inputs are incomplete'] : []),
  ];
  const status: TechnicalContextStatus =
    !latestCompleted
      ? 'unavailable'
      : dailyRegime.status === 'available' && h4Structure.status === 'available' && missingInputs.length === 0
        ? 'ready'
        : 'partial';

  return {
    sourceCandleTime: latestCompleted?.time ?? null,
    latestCandleStatus,
    indicatorSnapshot,
    dailyRegime,
    h4Structure,
    canonicalDailyRegime: dailyRegime.regime,
    canonicalH4Structure: h4Structure.structure,
    legacyDailyRegime: mapCanonicalDailyRegimeToLegacy(dailyRegime.regime),
    legacyH4Structure: mapCanonicalH4StructureToLegacy(h4Structure.structure),
    status,
    warnings,
    missingInputs,
  };
}

export function compareTechnicalContextToFixture(
  context: TechnicalContext,
  fixture: { dailyRegime?: unknown; h4Structure?: unknown; indicators?: FixtureIndicatorValues },
): TechnicalContextFixtureComparison {
  return {
    dailyRegime: {
      calculated: context.legacyDailyRegime,
      fixture: fixture.dailyRegime,
      matches: context.legacyDailyRegime === fixture.dailyRegime,
    },
    h4Structure: {
      calculated: context.legacyH4Structure,
      fixture: fixture.h4Structure,
      matches: context.legacyH4Structure === fixture.h4Structure,
    },
    indicators: Object.fromEntries(
      indicatorKeys.map((key) => {
        const calculated = context.indicatorSnapshot[key].value;
        const fixtureValue = fixture.indicators?.[key];
        return [
          key,
          {
            calculated,
            fixture: fixtureValue,
            difference:
              calculated === null || fixtureValue === undefined ? null : calculated - fixtureValue,
          },
        ];
      }),
    ) as TechnicalContextFixtureComparison['indicators'],
  };
}
