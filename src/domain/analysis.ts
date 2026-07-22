import { z } from 'zod';

import {
  ActionSchema,
  AnalysisReportSchema,
  CandleStatusSchema,
  DataFreshnessSchema,
  IndicatorSnapshotSchema,
  PriceZoneSchema,
  SetupGradeSchema,
  type Action,
  type AnalysisReport,
  type CandleStatus,
  type DataFreshness,
  type PriceZone,
} from '../schemas';
import { normalizeAnalysisInput } from './normalization';
import { enforceAnalysisSafety, type SafeAnalysisReport, type SafetyReason } from './safety';
import { prepareVersionedInput, type UnsupportedSchemaVersionError } from './versioning';

export {
  ActionSchema,
  AnalysisReportSchema as AnalysisSchema,
  CandleStatusSchema,
  DataFreshnessSchema,
  IndicatorSnapshotSchema,
  PriceZoneSchema,
  SetupGradeSchema as GradeSchema,
};
export type { Action, CandleStatus, DataFreshness, PriceZone, SafetyReason };

export type Analysis = AnalysisReport;
export type SafeAnalysis = SafeAnalysisReport;

export type AnalysisParseResult =
  | { success: true; analysis: SafeAnalysis; appliedMigrations: string[] }
  | { success: false; error: z.ZodError<AnalysisReport> | UnsupportedSchemaVersionError };

export function parseAnalysis(source: unknown): AnalysisParseResult {
  const versioned = prepareVersionedInput(source);
  if (!versioned.success) return versioned;

  const normalized = normalizeAnalysisInput(versioned.value);
  const parsed = AnalysisReportSchema.safeParse(normalized);

  if (!parsed.success) return { success: false, error: parsed.error };

  return {
    success: true,
    analysis: enforceAnalysisSafety(parsed.data),
    appliedMigrations: versioned.appliedMigrations,
  };
}
