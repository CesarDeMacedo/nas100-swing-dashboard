import { describe, expect, it } from 'vitest';

import { parseAnalysis } from '../domain/analysis';
import { parseCandleDataset } from '../domain/candles';
import { currentAnalysisSource, currentCandleDatasetSource } from '../domain/fixtures';
import { buildDashboardState, type DashboardState } from './buildDashboardState';
import { buildSwingReport, buildSwingReportOutput, formatSwingReport } from './buildSwingReport';

const fixtureState = (): DashboardState => {
  const analysis = parseAnalysis(currentAnalysisSource);
  const candles = parseCandleDataset(currentCandleDatasetSource);
  if (!analysis.success || !candles.success) throw new Error('Approved mock fixtures must validate.');
  return buildDashboardState(analysis.analysis, candles.dataset);
};

const stateFor = (action: DashboardState['action']): DashboardState => ({
  ...fixtureState(),
  action,
  actionLabel: action.replaceAll('_', ' '),
  direction: action === 'SELL' ? 'short' : action === 'NO_TRADE' || action === 'WAIT' ? 'none' : 'long',
  isActionable: action === 'BUY' || action === 'SELL',
  primaryReason: `${action} primary reason.`,
});

describe('buildSwingReport', () => {
  it('builds a structured report matching the dashboard state without mutation', () => {
    const state = fixtureState();
    const before = structuredClone(state);
    const report = buildSwingReport(state);

    expect(report.action).toBe(state.action);
    expect(report.score).toBe(state.score);
    expect(report.grade).toBe(state.grade);
    expect(report.direction).toBe(state.direction);
    expect(report.entryPrice).toBe(state.entryPrice);
    expect(report.stopPrice).toBe(state.stopPrice);
    expect(report.targets).toEqual(state.targets);
    expect(report.estimatedRewardRisk).toBe(state.estimatedRewardRisk);
    expect(report.primaryReason).toBe(state.primaryReason);
    expect(state).toEqual(before);
  });

  it('creates the expected current fixture report and explicit unavailable plan values', () => {
    const output = buildSwingReportOutput(fixtureState());

    expect(output.report.action).toBe('WAIT_FOR_PULLBACK');
    expect(output.report.direction).toBe('long');
    expect(output.report.score).toBe(38);
    expect(output.report.grade).toBe('D');
    expect(output.report.isActionable).toBe(false);
    expect(output.report.entryPrice).toBeNull();
    expect(output.report.stopPrice).toBeNull();
    expect(output.report.targets).toEqual([]);
    expect(output.report.estimatedRewardRisk).toBeNull();
    expect(output.text).toContain('Action: WAIT FOR PULLBACK (long, non-actionable)');
    expect(output.text).toContain('Entry Trigger: Waiting for pullback location');
    expect(output.text).toContain('Entry price: Not available');
    expect(output.text).toContain('ATR-aware Stop: Not calculated');
    expect(output.text).toContain('Targets: Not calculated');
    expect(output.text).toContain('Estimated R:R: Not available');
  });

  it.each([
    ['BUY', 'Long setup confirmed and actionable.'],
    ['SELL', 'Short setup confirmed and actionable.'],
    ['WAIT_FOR_NEXT_4H_CLOSE', 'Setup location is acceptable, but the next completed H4 candle must confirm.'],
    ['WAIT', 'Evidence is incomplete.'],
    ['NO_TRADE', 'Trading is blocked by the current safety state.'],
  ] as const)('formats deterministic %s action messaging', (action, message) => {
    expect(formatSwingReport(buildSwingReport(stateFor(action)))).toContain(message);
  });

  it('adds stale and open-candle data-health warnings', () => {
    const state = stateFor('NO_TRADE');
    state.dataFreshness = 'STALE';
    state.dataHealth = { ...state.dataHealth, latestCandleClosed: false };

    const text = formatSwingReport(buildSwingReport(state));
    expect(text).toContain('Market data is stale.');
    expect(text).toContain('Latest H4 candle is open or unconfirmed.');
  });

  it('is deterministic across repeated builds', () => {
    const state = fixtureState();
    expect(buildSwingReportOutput(state)).toEqual(buildSwingReportOutput(state));
  });
});
