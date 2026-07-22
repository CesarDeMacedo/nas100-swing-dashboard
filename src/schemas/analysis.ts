import { z } from 'zod';

import {
  ActionSchema,
  BiasSchema,
  CandleStatusSchema,
  CrossMarketConfirmationSchema,
  CrossMarketInstrumentSchema,
  DailyRegimeSchema,
  DataFreshnessSchema,
  DataHealthStatusSchema,
  EventRiskSeveritySchema,
  EventRiskStatusSchema,
  H4StructureSchema,
  InstrumentConfirmationSchema,
  ProviderStatusSchema,
  SetupGradeSchema,
  SetupStatusSchema,
  TimeframeSchema,
  ZoneTypeSchema,
} from './enums';
import {
  NonEmptyStringSchema,
  PercentageSchema,
  PositivePriceSchema,
  StringListSchema,
  TimestampSchema,
} from './primitives';
import { SchemaVersionSchema } from './version';

export const PriceZoneSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: ZoneTypeSchema,
    low: PositivePriceSchema,
    high: PositivePriceSchema,
    label: NonEmptyStringSchema,
    source: NonEmptyStringSchema,
    confidence: PercentageSchema,
    lockedByUser: z.boolean(),
  })
  .superRefine((zone, context) => {
    if (zone.low > zone.high) {
      context.addIssue({
        code: 'custom',
        message: 'Zone low must not exceed zone high',
        path: ['low'],
      });
    }
  });

export const IndicatorSnapshotSchema = z.object({
  ema5: PositivePriceSchema.optional(),
  ema8: PositivePriceSchema.optional(),
  ema13: PositivePriceSchema.optional(),
  ema20: PositivePriceSchema.optional(),
  ema21: PositivePriceSchema.optional(),
  ema50: PositivePriceSchema.optional(),
  ema200: PositivePriceSchema.optional(),
  rsi14: z.number().finite().min(0).max(100).optional(),
  atr14: z.number().finite().positive().optional(),
  distanceFromEma20Atr: z.number().finite().optional(),
});

export const MarketInstrumentSnapshotSchema = z.object({
  instrument: CrossMarketInstrumentSchema,
  confirmation: InstrumentConfirmationSchema,
  dataFreshness: DataFreshnessSchema,
  lastPrice: PositivePriceSchema.optional(),
  changePercent: z.number().finite().optional(),
  completedCandleAt: TimestampSchema.optional(),
  notes: StringListSchema,
});

export const CrossMarketSnapshotSchema = z
  .object({
    us500: MarketInstrumentSnapshotSchema,
    us30: MarketInstrumentSnapshotSchema,
    russell2000: MarketInstrumentSnapshotSchema,
    confirmationStatus: CrossMarketConfirmationSchema,
    dataFreshness: DataFreshnessSchema,
    notes: StringListSchema,
  })
  .superRefine((snapshot, context) => {
    const expected = [
      ['us500', snapshot.us500.instrument, 'US500'],
      ['us30', snapshot.us30.instrument, 'US30'],
      ['russell2000', snapshot.russell2000.instrument, 'RUSSELL_2000'],
    ] as const;

    expected.forEach(([key, actual, required]) => {
      if (actual !== required) {
        context.addIssue({
          code: 'custom',
          message: `${key} must identify ${required}`,
          path: [key, 'instrument'],
        });
      }
    });
  });

export const EventRiskSchema = z.object({
  status: EventRiskStatusSchema,
  severity: EventRiskSeveritySchema,
  eventName: NonEmptyStringSchema,
  eventTime: TimestampSchema,
  source: NonEmptyStringSchema,
  freshness: DataFreshnessSchema,
  blocksEntry: z.boolean(),
  notes: StringListSchema,
});

export const DataHealthSchema = z.object({
  status: DataHealthStatusSchema,
  providerStatus: ProviderStatusSchema,
  lastSuccessfulUpdate: TimestampSchema.optional(),
  latestExpectedCandleTime: TimestampSchema.optional(),
  latestAvailableCandleTime: TimestampSchema.optional(),
  latestCandleClosed: z.boolean().optional(),
  staleAfterMinutes: z.number().int().positive(),
  validationErrors: StringListSchema,
  warnings: StringListSchema,
});

export const SetupScoreBreakdownSchema = z.object({
  trend: z.number().finite().nonnegative(),
  structure: z.number().finite().nonnegative(),
  momentum: z.number().finite().nonnegative(),
  location: z.number().finite().nonnegative(),
  crossMarket: z.number().finite().nonnegative(),
  eventRisk: z.number().finite().nonnegative(),
  rewardRisk: z.number().finite().nonnegative(),
  patienceFilter: z.number().finite().nonnegative(),
  total: z.number().int().min(0).max(100),
});

export const CandlesReferenceSchema = z.object({
  datasetId: NonEmptyStringSchema,
  instrument: NonEmptyStringSchema,
  timeframe: TimeframeSchema,
  latestCandleTime: TimestampSchema,
  candleCount: z.number().int().positive(),
  synthetic: z.boolean(),
});

export const DataProviderStatusSchema = z.object({
  provider: NonEmptyStringSchema,
  status: ProviderStatusSchema,
  observedAt: TimestampSchema,
  lastSuccessfulUpdate: TimestampSchema.optional(),
  message: NonEmptyStringSchema.optional(),
});

export const gradeForScore = (score: number) => {
  if (score >= 90) return 'A+' as const;
  if (score >= 80) return 'A' as const;
  if (score >= 70) return 'B' as const;
  if (score >= 60) return 'C+' as const;
  if (score >= 50) return 'C' as const;
  return 'D' as const;
};

export const AnalysisReportSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    strategyVersion: NonEmptyStringSchema,
    id: NonEmptyStringSchema,
    generatedAt: TimestampSchema,
    completedCandleAt: TimestampSchema,
    officialTimezone: z.literal('America/Toronto'),
    instrument: NonEmptyStringSchema,
    displayName: NonEmptyStringSchema,
    timeframe: TimeframeSchema,
    dataProvider: NonEmptyStringSchema,
    dataFreshness: DataFreshnessSchema,
    latestCandleStatus: CandleStatusSchema,
    dailyRegime: DailyRegimeSchema,
    h4Structure: H4StructureSchema,
    bias: BiasSchema,
    status: SetupStatusSchema,
    action: ActionSchema,
    score: z.number().int().min(0).max(100),
    grade: SetupGradeSchema,
    confidence: PercentageSchema,
    currentPrice: PositivePriceSchema,
    changePercent: z.number().finite(),
    supportZones: z.array(PriceZoneSchema),
    resistanceZones: z.array(PriceZoneSchema),
    preferredEntryZone: PriceZoneSchema.optional(),
    entryTrigger: NonEmptyStringSchema.optional(),
    invalidation: PositivePriceSchema.optional(),
    stop: PositivePriceSchema.optional(),
    targets: z.array(PositivePriceSchema),
    estimatedRR: z.number().finite().nonnegative().optional(),
    reason: NonEmptyStringSchema.optional(),
    whyNoEntry: StringListSchema,
    whatToDoNext: StringListSchema,
    marketContext: StringListSchema,
    indicators: IndicatorSnapshotSchema,
    crossMarket: CrossMarketSnapshotSchema,
    eventRisk: z.array(EventRiskSchema),
    dataHealth: DataHealthSchema,
    setupScoreBreakdown: SetupScoreBreakdownSchema,
    candlesReference: CandlesReferenceSchema,
  })
  .superRefine((report, context) => {
    if (report.grade !== gradeForScore(report.score)) {
      context.addIssue({
        code: 'custom',
        message: 'Grade must match the approved score bands',
        path: ['grade'],
      });
    }

    if (report.setupScoreBreakdown.total !== report.score) {
      context.addIssue({
        code: 'custom',
        message: 'Setup score breakdown total must match report score',
        path: ['setupScoreBreakdown', 'total'],
      });
    }

    if (report.preferredEntryZone && report.preferredEntryZone.type !== 'ENTRY') {
      context.addIssue({
        code: 'custom',
        message: 'Preferred entry zone must use ENTRY type',
        path: ['preferredEntryZone', 'type'],
      });
    }

    report.supportZones.forEach((zone, index) => {
      if (zone.type !== 'SUPPORT') {
        context.addIssue({
          code: 'custom',
          message: 'Support zones must use SUPPORT type',
          path: ['supportZones', index, 'type'],
        });
      }
    });

    report.resistanceZones.forEach((zone, index) => {
      if (zone.type !== 'RESISTANCE') {
        context.addIssue({
          code: 'custom',
          message: 'Resistance zones must use RESISTANCE type',
          path: ['resistanceZones', index, 'type'],
        });
      }
    });
  });

export type PriceZone = z.infer<typeof PriceZoneSchema>;
export type IndicatorSnapshot = z.infer<typeof IndicatorSnapshotSchema>;
export type MarketInstrumentSnapshot = z.infer<typeof MarketInstrumentSnapshotSchema>;
export type CrossMarketSnapshot = z.infer<typeof CrossMarketSnapshotSchema>;
export type EventRisk = z.infer<typeof EventRiskSchema>;
export type DataHealth = z.infer<typeof DataHealthSchema>;
export type SetupScoreBreakdown = z.infer<typeof SetupScoreBreakdownSchema>;
export type DataProviderStatus = z.infer<typeof DataProviderStatusSchema>;
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;
