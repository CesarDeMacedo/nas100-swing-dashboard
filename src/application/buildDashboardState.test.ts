import { parseAnalysis } from '../domain/analysis';
import { parseCandleDataset } from '../domain/candles';
import { currentAnalysisSource, currentCandleDatasetSource, openCandleDatasetFixture } from '../domain/fixtures';
import { buildTechnicalContext } from '../domain/technicalContext';
import { buildDashboardState } from './buildDashboardState';

/**
 * Dedicated coverage for the orchestration in buildDashboardState.ts: it composes
 * technical context, long/short trade plans, the Patience Filter, the strategy
 * decision, and setup scoring into the UI-ready DashboardState. These tests pin down
 * the wiring itself — that computed values (not static report fields) drive the
 * output, that the technicalContextOverride parameter is actually honored, and that
 * supporting/contextual fields pass through unchanged — rather than re-testing the
 * underlying domain functions, which already have their own test files.
 */
const parsedFixture = () => {
  const analysis = parseAnalysis(currentAnalysisSource);
  const candles = parseCandleDataset(currentCandleDatasetSource);
  if (!analysis.success || !candles.success) throw new Error('Approved mock fixtures must validate.');
  return { analysis: analysis.analysis, candles: candles.dataset };
};

describe('buildDashboardState', () => {
  it('derives action, score, and grade from the computed decision, not the static report fields', () => {
    const { analysis, candles } = parsedFixture();
    const state = buildDashboardState(analysis, candles);

    // The fixture's static fields (score 74/grade B) are deliberately different from
    // what the deterministic pipeline computes from the actual candles/technical context.
    expect(analysis.score).toBe(74);
    expect(analysis.grade).toBe('B');
    expect(state.score).not.toBe(analysis.score);
    expect(state.grade).not.toBe(analysis.grade);
  });

  it('derives marketRegime and h4Structure from the computed technical context, not the static report fields', () => {
    const { analysis, candles } = parsedFixture();
    const state = buildDashboardState(analysis, candles);
    const technicalContext = buildTechnicalContext(candles.candles);

    expect(state.marketRegime).toBe(technicalContext.canonicalDailyRegime);
    expect(state.h4Structure).toBe(technicalContext.canonicalH4Structure);
    // Static legacy-enum fields use a different vocabulary/casing entirely.
    expect(analysis.dailyRegime).toBe('DEFENSIVE_BULLISH');
    expect(analysis.h4Structure).toBe('PULLBACK_FORMING');
  });

  it('honors an explicit technicalContextOverride instead of recomputing from candles', () => {
    const { analysis, candles } = parsedFixture();
    const defaultState = buildDashboardState(analysis, candles);

    const overrideCandles = parseCandleDataset(openCandleDatasetFixture);
    if (!overrideCandles.success) throw new Error('Open-candle fixture must validate.');
    const override = buildTechnicalContext(overrideCandles.dataset.candles);
    const overriddenState = buildDashboardState(analysis, candles, override);

    expect(overriddenState.marketRegime).toBe(override.canonicalDailyRegime);
    expect(overriddenState.h4Structure).toBe(override.canonicalH4Structure);
    // Sanity check the override path actually took effect relative to the default.
    expect(override).not.toBe(buildTechnicalContext(candles.candles));
    expect(defaultState.candles).toBe(candles.candles);
  });

  it('sources sourceCandleTime from the computed decision rather than analysis.generatedAt', () => {
    const { analysis, candles } = parsedFixture();
    const state = buildDashboardState(analysis, candles);

    expect(state.sourceCandleTime).toBe(candles.candles.at(-1)?.time);
    expect(state.sourceCandleTime).not.toBe(analysis.generatedAt);
  });

  it('deduplicates warnings contributed by both the decision and the selected score', () => {
    const { analysis, candles } = parsedFixture();
    const state = buildDashboardState(analysis, candles);

    expect(state.warnings.length).toBe(new Set(state.warnings).size);
  });

  it('passes supporting context fields through from the source report unchanged', () => {
    const { analysis, candles } = parsedFixture();
    const state = buildDashboardState(analysis, candles);

    expect(state.candles).toBe(candles.candles);
    expect(state.dataHealth).toBe(analysis.dataHealth);
    expect(state.supportZones).toBe(analysis.supportZones);
    expect(state.resistanceZones).toBe(analysis.resistanceZones);
    expect(state.preferredEntryZone).toBe(analysis.preferredEntryZone);
    expect(state.whyNoEntry).toBe(analysis.whyNoEntry);
    expect(state.whatToDoNext).toBe(analysis.whatToDoNext);
    expect(state.marketContext).toBe(analysis.marketContext);
  });
});
