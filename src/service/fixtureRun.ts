import { randomUUID } from 'node:crypto';

import { buildDashboardState } from '../application/buildDashboardState';
import { buildSwingReport, type SwingReport } from '../application/buildSwingReport';
import { currentAnalysisSource, currentCandleDatasetSource } from '../domain/fixtures';
import { AnalysisRepository, type StoredAnalysisRun } from '../persistence/analysisRepository';
import { AnalysisReportSchema, CandleDatasetSchema } from '../schemas';

export type FixtureRunResult = {
  outcome: 'created' | 'already_exists' | 'blocked' | 'failed';
  run: StoredAnalysisRun;
  report: SwingReport | null;
  message?: string;
};

export const fixtureRunKey = (report: SwingReport, strategyVersion: string) =>
  [report.instrument, report.timeframe, report.sourceCandleTime ?? 'unavailable', report.reportVersion, strategyVersion, 'fixture'].join(':');

const blockedRunKey = (instrument: string, timeframe: string, sourceCandleTime: string | null, strategyVersion: string) =>
  [instrument, timeframe, sourceCandleTime ?? 'unavailable', 'blocked', strategyVersion, 'fixture'].join(':');

export const runSyntheticFixtureAnalysis = (
  repository: AnalysisRepository,
  sources = { analysis: currentAnalysisSource, candles: currentCandleDatasetSource },
): FixtureRunResult => {
  const startedAt = new Date().toISOString();

  try {
    const analysis = AnalysisReportSchema.parse(sources.analysis);
    const candles = CandleDatasetSchema.parse(sources.candles);
    const latestCandle = candles.candles.at(-1);

    if (!latestCandle?.isClosed) {
      const runKey = blockedRunKey(analysis.instrument, analysis.timeframe, latestCandle?.time ?? null, analysis.strategyVersion);
      const existing = repository.getRunByKey(runKey);
      if (existing) return { outcome: 'already_exists', run: existing.run, report: existing.report, message: 'Latest synthetic H4 candle is not completed.' };
      const run = repository.saveNonCompletedRun({
        id: randomUUID(),
        runKey,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'BLOCKED',
        source: 'fixture',
        errorMessage: 'Latest synthetic H4 candle is not completed.',
      });
      return { outcome: 'blocked', run, report: null, message: run.errorMessage ?? undefined };
    }

    const dashboardState = buildDashboardState(analysis, candles);
    const report = buildSwingReport(dashboardState);
    const runKey = fixtureRunKey(report, analysis.strategyVersion);
    const existing = repository.getRunByKey(runKey);
    if (existing?.report) return { outcome: 'already_exists', run: existing.run, report: existing.report };

    const completedAt = new Date().toISOString();
    const run = repository.saveCompletedRun(
      {
        id: randomUUID(),
        runKey,
        startedAt,
        completedAt,
        status: 'COMPLETED',
        source: 'fixture',
      },
      report,
    );
    return { outcome: 'created', run, report };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Synthetic fixture analysis could not be completed.';
    const runKey = `fixture:failed:${startedAt}`;
    const run = repository.saveNonCompletedRun({
      id: randomUUID(),
      runKey,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'FAILED',
      source: 'fixture',
      errorMessage: message,
    });
    return { outcome: 'failed', run, report: null, message };
  }
};
