import { z } from 'zod';

export const ACTIONS = [
  'BUY',
  'SELL',
  'WAIT',
  'NO_TRADE',
  'WAIT_FOR_PULLBACK',
  'WAIT_FOR_NEXT_4H_CLOSE',
] as const;
export const ActionSchema = z.enum(ACTIONS);

export const SETUP_STATUSES = [
  'SETUP_FORMING',
  'SETUP_CONFIRMED',
  'SETUP_INVALIDATED',
  'AWAITING_CANDLE_CLOSE',
  'BLOCKED',
  'NO_SETUP',
  'DATA_UNAVAILABLE',
] as const;
export const SetupStatusSchema = z.enum(SETUP_STATUSES);

export const BIASES = [
  'BULLISH',
  'BEARISH',
  'NEUTRAL',
  'BULLISH_CAUTIOUS',
  'BEARISH_CAUTIOUS',
] as const;
export const BiasSchema = z.enum(BIASES);

export const DAILY_REGIMES = [
  'BULLISH',
  'BEARISH',
  'DEFENSIVE_BULLISH',
  'DEFENSIVE_BEARISH',
  'NEUTRAL',
  'TRANSITIONAL',
] as const;
export const DailyRegimeSchema = z.enum(DAILY_REGIMES);

export const DAILY_REGIME_CLASSIFICATIONS = [
  'strong_bullish',
  'defensive_bullish',
  'neutral',
  'defensive_bearish',
  'strong_bearish',
  'unavailable',
] as const;
export const DailyRegimeClassificationSchema = z.enum(DAILY_REGIME_CLASSIFICATIONS);

export const H4_STRUCTURES = [
  'PULLBACK_FORMING',
  'BULLISH_CONTINUATION',
  'BEARISH_CONTINUATION',
  'BREAKDOWN',
  'BREAKOUT',
  'RANGE',
  'UNKNOWN',
] as const;
export const H4StructureSchema = z.enum(H4_STRUCTURES);

export const H4_STRUCTURE_CLASSIFICATIONS = [
  'bullish_trend',
  'bearish_trend',
  'bullish_pullback',
  'bearish_pullback',
  'consolidation',
  'bullish_breakout',
  'bearish_breakout',
  'bullish_reversal_attempt',
  'bearish_reversal_attempt',
  'unavailable',
] as const;
export const H4StructureClassificationSchema = z.enum(H4_STRUCTURE_CLASSIFICATIONS);

export const CANDLE_STATUSES = ['COMPLETED', 'OPEN', 'UNKNOWN'] as const;
export const CandleStatusSchema = z.enum(CANDLE_STATUSES);

export const DATA_FRESHNESS_STATES = ['FRESH', 'STALE', 'MISSING', 'INVALID', 'MOCK'] as const;
export const DataFreshnessSchema = z.enum(DATA_FRESHNESS_STATES);

export const DATA_HEALTH_STATES = [
  'HEALTHY',
  'DEGRADED',
  'STALE',
  'INVALID',
  'UNAVAILABLE',
] as const;
export const DataHealthStatusSchema = z.enum(DATA_HEALTH_STATES);

export const PROVIDER_STATUSES = [
  'HEALTHY',
  'DEGRADED',
  'UNAVAILABLE',
  'UNCONFIGURED',
  'MOCK',
] as const;
export const ProviderStatusSchema = z.enum(PROVIDER_STATUSES);

export const EVENT_RISK_SEVERITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'BLOCKING'] as const;
export const EventRiskSeveritySchema = z.enum(EVENT_RISK_SEVERITIES);

export const EVENT_RISK_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'NOT_APPLICABLE'] as const;
export const EventRiskStatusSchema = z.enum(EVENT_RISK_STATUSES);

export const ZONE_TYPES = ['SUPPORT', 'RESISTANCE', 'ENTRY', 'INVALIDATION', 'TARGET'] as const;
export const ZoneTypeSchema = z.enum(ZONE_TYPES);

export const SETUP_GRADES = ['D', 'C', 'C+', 'B', 'A', 'A+'] as const;
export const SetupGradeSchema = z.enum(SETUP_GRADES);

export const TIMEFRAMES = ['H4'] as const;
export const TimeframeSchema = z.enum(TIMEFRAMES);

export const CROSS_MARKET_CONFIRMATIONS = [
  'CONFIRMING',
  'MIXED',
  'CONTRADICTING',
  'UNAVAILABLE',
] as const;
export const CrossMarketConfirmationSchema = z.enum(CROSS_MARKET_CONFIRMATIONS);

export const INSTRUMENT_CONFIRMATIONS = [
  'CONFIRMING',
  'NEUTRAL',
  'CONTRADICTING',
  'UNAVAILABLE',
] as const;
export const InstrumentConfirmationSchema = z.enum(INSTRUMENT_CONFIRMATIONS);

export const CROSS_MARKET_INSTRUMENTS = ['US500', 'US30', 'RUSSELL_2000'] as const;
export const CrossMarketInstrumentSchema = z.enum(CROSS_MARKET_INSTRUMENTS);

export type Action = z.infer<typeof ActionSchema>;
export type SetupStatus = z.infer<typeof SetupStatusSchema>;
export type Bias = z.infer<typeof BiasSchema>;
export type DailyRegime = z.infer<typeof DailyRegimeSchema>;
export type DailyRegimeClassification = z.infer<typeof DailyRegimeClassificationSchema>;
export type H4Structure = z.infer<typeof H4StructureSchema>;
export type H4StructureClassification = z.infer<typeof H4StructureClassificationSchema>;
export type CandleStatus = z.infer<typeof CandleStatusSchema>;
export type DataFreshness = z.infer<typeof DataFreshnessSchema>;
export type DataHealthStatus = z.infer<typeof DataHealthStatusSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export type EventRiskSeverity = z.infer<typeof EventRiskSeveritySchema>;
export type ZoneType = z.infer<typeof ZoneTypeSchema>;
export type SetupGrade = z.infer<typeof SetupGradeSchema>;
export type Timeframe = z.infer<typeof TimeframeSchema>;
export type CrossMarketInstrument = z.infer<typeof CrossMarketInstrumentSchema>;
