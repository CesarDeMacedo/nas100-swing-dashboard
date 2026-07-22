import currentAnalysis from '../../mock/current-analysis.json';
import candleDataset from '../../mock/nas100-h4-candles.json';
import {
  AnalysisReportSchema,
  ApplicationSettingsSchema,
  CandleDatasetSchema,
  CrossMarketSnapshotSchema,
  DataHealthSchema,
  DataProviderStatusSchema,
  EventRiskSchema,
  IndicatorSnapshotSchema,
  MarketInstrumentSnapshotSchema,
  PriceZoneSchema,
  SetupScoreBreakdownSchema,
} from './index';

const cloneAnalysis = () => structuredClone(currentAnalysis);

describe('central schema contracts', () => {
  it('validates the committed AnalysisReport and candle dataset directly', () => {
    expect(AnalysisReportSchema.safeParse(currentAnalysis).success).toBe(true);
    expect(CandleDatasetSchema.safeParse(candleDataset).success).toBe(true);
  });

  it('validates every main nested analysis schema', () => {
    expect(IndicatorSnapshotSchema.safeParse(currentAnalysis.indicators).success).toBe(true);
    expect(CrossMarketSnapshotSchema.safeParse(currentAnalysis.crossMarket).success).toBe(true);
    expect(
      MarketInstrumentSnapshotSchema.safeParse(currentAnalysis.crossMarket.us500).success,
    ).toBe(true);
    expect(EventRiskSchema.safeParse(currentAnalysis.eventRisk[0]).success).toBe(true);
    expect(DataHealthSchema.safeParse(currentAnalysis.dataHealth).success).toBe(true);
    expect(SetupScoreBreakdownSchema.safeParse(currentAnalysis.setupScoreBreakdown).success).toBe(
      true,
    );
  });

  it('validates provider status and application settings contracts', () => {
    expect(
      DataProviderStatusSchema.safeParse({
        provider: 'mock',
        status: 'MOCK',
        observedAt: '2026-07-22T01:10:00.000Z',
      }).success,
    ).toBe(true);

    expect(
      ApplicationSettingsSchema.safeParse({
        schemaVersion: '1.0.0',
        timezone: 'America/Toronto',
        timeframe: 'H4',
        scheduledReviewTimes: ['13:01', '21:01'],
        minimumRewardRisk: 2,
        staleDataThresholdMinutes: 250,
        preferredInstrument: 'NAS100',
        notificationsEnabled: false,
        exportDirectory: null,
      }).success,
    ).toBe(true);
  });

  it.each([0, 100])('accepts score boundary %i', (score) => {
    const report = cloneAnalysis();
    report.score = score;
    report.grade = score === 100 ? 'A+' : 'D';
    report.setupScoreBreakdown.total = score;

    expect(AnalysisReportSchema.safeParse(report).success).toBe(true);
  });

  it.each([-1, 101])('rejects score outside the boundary: %i', (score) => {
    const report = cloneAnalysis();
    report.score = score;
    report.setupScoreBreakdown.total = Math.max(0, Math.min(100, score));

    expect(AnalysisReportSchema.safeParse(report).success).toBe(false);
  });

  it.each([0, 100])('accepts confidence boundary %i', (confidence) => {
    const report = cloneAnalysis();
    report.confidence = confidence;

    expect(AnalysisReportSchema.safeParse(report).success).toBe(true);
  });

  it.each([-0.1, 100.1])('rejects confidence outside the boundary: %i', (confidence) => {
    const report = cloneAnalysis();
    report.confidence = confidence;

    expect(AnalysisReportSchema.safeParse(report).success).toBe(false);
  });

  it('rejects an inverted price zone', () => {
    const zone = { ...currentAnalysis.supportZones[0], low: 29000, high: 28900 };

    expect(PriceZoneSchema.safeParse(zone).success).toBe(false);
  });

  it('rejects negative reward-to-risk and invalid numeric trade levels', () => {
    const negativeRewardRisk = { ...cloneAnalysis(), estimatedRR: -0.1 };
    const invalidStop = { ...cloneAnalysis(), stop: Number.NaN };

    expect(AnalysisReportSchema.safeParse(negativeRewardRisk).success).toBe(false);
    expect(AnalysisReportSchema.safeParse(invalidStop).success).toBe(false);
  });

  it('rejects invalid RFC 3339 timestamps', () => {
    const report = { ...cloneAnalysis(), generatedAt: 'July 21, 2026 at nine' };

    expect(AnalysisReportSchema.safeParse(report).success).toBe(false);
  });

  it('rejects an application minimum reward-to-risk below 2.0', () => {
    const result = ApplicationSettingsSchema.safeParse({
      schemaVersion: '1.0.0',
      timezone: 'America/Toronto',
      timeframe: 'H4',
      scheduledReviewTimes: ['13:01', '21:01'],
      minimumRewardRisk: 1.99,
      staleDataThresholdMinutes: 250,
      preferredInstrument: 'NAS100',
      notificationsEnabled: false,
      exportDirectory: null,
    });

    expect(result.success).toBe(false);
  });
});
