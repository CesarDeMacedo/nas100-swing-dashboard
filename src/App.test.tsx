import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';

import App from './App';
import type { HistoryResult, LocalAnalysisServiceClient, ManualRunResult, RunDetailResult } from './serviceClient/localAnalysisService';
import { getActionState } from './domain/actionStates';
import { ActionSchema } from './domain/analysis';
import {
  actionFixtures,
  invalidAnalysisFixture,
  invalidCandleDatasetFixture,
  missingNarrativeFixture,
  openCandleDatasetFixture,
  openCandleFixture,
  staleDataFixture,
} from './domain/fixtures';

const readSourceTree = (directory: string): string =>
  readdirSync(directory)
    .map((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? readSourceTree(path) : readFileSync(path, 'utf8');
    })
    .join('\n');

describe('dashboard rendering', () => {
  const run: ManualRunResult = {
    kind: 'succeeded',
    run: {
      id: 'run-1',
      runKey: 'fixture-run',
      action: 'WAIT_FOR_PULLBACK',
      direction: 'long',
      score: 38,
      grade: 'D',
      isActionable: false,
      sourceCandleTime: '2026-07-22T01:00:00.000Z',
      persistedAt: '2026-07-22T01:01:00.000Z',
      alreadyExists: false,
    },
  };
  const client = (checkHealth: LocalAnalysisServiceClient['checkHealth'], runManualFixture: LocalAnalysisServiceClient['runManualFixture'], listRecentRuns: LocalAnalysisServiceClient['listRecentRuns'] = async () => ({ kind: 'empty', runs: [] }), getRunByKey: LocalAnalysisServiceClient['getRunByKey'] = async () => ({ kind: 'failed', message: 'not selected' })): LocalAnalysisServiceClient => ({ checkHealth, runManualFixture, listRecentRuns, getRunByKey });
  const historyItem = { run: { id: 'run-1', runKey: 'fixture-run', completedAt: '2026-07-22T01:01:00.000Z', status: 'COMPLETED', source: 'fixture', persistedAt: '2026-07-22T01:01:01.000Z', reportId: 'report-1' }, report: { action: 'WAIT_FOR_PULLBACK', direction: 'long', score: 38, grade: 'D', sourceCandleTime: '2026-07-22T01:00:00.000Z', isActionable: false } };
  const historyDetail: RunDetailResult = { kind: 'succeeded', item: historyItem, report: { ...historyItem.report, primaryReason: 'Pullback location is pending.', entryTrigger: null, stopPrice: null, targets: [], estimatedRewardRisk: null } };

  it('renders local service health and preserves the fixture dashboard while offline', async () => {
    render(<App serviceClient={client(async () => ({ kind: 'unavailable', message: 'offline' }), async () => ({ kind: 'failed', message: 'offline' }))} />);

    expect(await screen.findByText('Service unavailable')).toBeVisible();
    expect(screen.getByText('Start the local analysis service to enable manual persistence.')).toBeVisible();
    expect(screen.getByTestId('dashboard')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run mock analysis' })).toBeDisabled();
  });

  it('renders successful and duplicate fixture persistence without changing the dashboard action', async () => {
    const runManualFixture = vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, kind: 'already_exists' as const, run: { ...run.run, alreadyExists: true } });
    render(<App serviceClient={client(async () => ({ kind: 'available' }), runManualFixture)} />);

    const button = await screen.findByRole('button', { name: 'Run mock analysis' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(await screen.findByText('Mock analysis saved')).toBeVisible();
    expect(screen.getByLabelText('Current action: WAIT FOR PULLBACK')).toBeVisible();

    fireEvent.click(button);
    expect(await screen.findByText('Mock analysis already recorded')).toBeVisible();
  });

  it('renders failed and malformed manual-run states without execution language', async () => {
    const malformed: ManualRunResult = { kind: 'malformed_response', message: 'Local service returned an invalid manual-run response.' };
    const runManualFixture = vi.fn().mockResolvedValueOnce({ kind: 'failed' as const, message: 'Manual analysis could not be saved.' }).mockResolvedValueOnce(malformed);
    render(<App serviceClient={client(async () => ({ kind: 'available' }), runManualFixture)} />);

    const button = await screen.findByRole('button', { name: 'Run mock analysis' });
    fireEvent.click(button);
    expect(await screen.findByText('Could not save mock analysis')).toBeVisible();
    fireEvent.click(button);
    expect(await screen.findByText('Could not save mock analysis')).toBeVisible();
    expect(screen.queryByText(/trade executed/i)).not.toBeInTheDocument();
  });

  it('keeps the compact mock-service utility separate from the title flow', async () => {
    render(<App serviceClient={client(async () => ({ kind: 'available' }), async () => run)} />);

    const control = await screen.findByLabelText('Synthetic local analysis service');
    const title = screen.getByRole('heading', { name: 'NAS100 H4 Setup Check' });
    expect(control).toHaveAttribute('title', 'Synthetic fixture persistence only');
    expect(title.closest('.dashboard-title-block')).not.toContainElement(control);
    expect(control).toHaveTextContent('Service online');
  });

  it('opens, refreshes, selects, and closes read-only local analysis history', async () => {
    const listRecentRuns = vi.fn<LocalAnalysisServiceClient['listRecentRuns']>().mockResolvedValue({ kind: 'succeeded', runs: [historyItem] } as HistoryResult);
    const getRunByKey = vi.fn<LocalAnalysisServiceClient['getRunByKey']>().mockResolvedValue(historyDetail);
    render(<App serviceClient={client(async () => ({ kind: 'available' }), async () => run, listRecentRuns, getRunByKey)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open analysis history' }));
    expect(await screen.findByRole('dialog', { name: 'Analysis history' })).toBeVisible();
    const historyDialog = await screen.findByRole('dialog', { name: 'Analysis history' });
    expect(within(historyDialog).getByText('WAIT FOR PULLBACK')).toBeVisible();
    fireEvent.click(within(historyDialog).getByRole('button', { name: /WAIT FOR PULLBACK/ }));
    expect(await screen.findByText('Pullback location is pending.')).toBeVisible();
    expect(screen.getAllByText('Not calculated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Current action: WAIT FOR PULLBACK')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(listRecentRuns).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Analysis history' })).not.toBeInTheDocument();
  });

  it('opens a saved OANDA snapshot in the dashboard and returns to mock data without provider calls', async () => {
    const savedAnalysis = structuredClone(actionFixtures.WAIT) as Record<string, unknown>;
    Object.assign(savedAnalysis, {
      id: 'saved-oanda-analysis', instrument: 'NAS100_USD', displayName: 'NAS100_USD', dataProvider: 'OANDA v20', currentPrice: 30123,
      supportZones: [{ id: 'saved-support', type: 'SUPPORT', low: 30000, high: 30020, label: 'Saved support', source: 'OANDA H4', confidence: 70, lockedByUser: false }],
      resistanceZones: [{ id: 'saved-resistance', type: 'RESISTANCE', low: 30200, high: 30220, label: 'Saved resistance', source: 'OANDA H4', confidence: 70, lockedByUser: false }],
      preferredEntryZone: { id: 'saved-entry', type: 'ENTRY', low: 30000, high: 30020, label: 'Saved entry', source: 'OANDA H4', confidence: 70, lockedByUser: false },
    });
    const snapshot = {
      provider: 'oanda-v20' as const, environment: 'practice' as const, instrument: 'NAS100_USD', timeframe: 'H4' as const,
      candles: [{ time: '2026-07-22T00:00:00.000Z', open: 30100, high: 30140, low: 30080, close: 30123, isClosed: true, instrument: 'NAS100_USD', timeframe: 'H4', source: 'oanda-v20' }],
      analysis: savedAnalysis, h4SourceCandleTime: '2026-07-22T00:00:00.000Z', dailySourceCandleTime: null, warnings: ['Saved only.'],
    };
    const detail: RunDetailResult = { kind: 'succeeded', item: historyItem, report: { ...historyDetail.report, displaySnapshot: snapshot } };
    const listRecentRuns = async () => ({ kind: 'succeeded' as const, runs: [historyItem] });
    const getRunByKey = async () => detail;
    render(<App serviceClient={client(async () => ({ kind: 'available' }), async () => run, listRecentRuns, getRunByKey)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open analysis history' }));
    const historyDialog = await screen.findByRole('dialog', { name: 'Analysis history' });
    fireEvent.click(within(historyDialog).getByRole('button', { name: /WAIT FOR PULLBACK/ }));
    fireEvent.click(await within(historyDialog).findByRole('button', { name: 'View in dashboard' }));

    expect(screen.queryByRole('dialog', { name: 'Analysis history' })).not.toBeInTheDocument();
    expect(screen.getByText('OANDA PRACTICE — SAVED ANALYSIS')).toBeVisible();
    expect(screen.getByTestId('current-price-marker')).toHaveTextContent('30,123');
    expect(screen.getAllByTestId('support-zone')).toHaveLength(1);
    expect(screen.getByText(/saved OANDA candles/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to mock dashboard' }));
    expect(screen.queryByText('OANDA PRACTICE — SAVED ANALYSIS')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-price-marker')).toHaveTextContent('29,082');
  });

  it('shows empty and failed history states without execution wording', async () => {
    const empty = async () => ({ kind: 'empty' as const, runs: [] as [] });
    render(<App serviceClient={client(async () => ({ kind: 'available' }), async () => run, empty)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open analysis history' }));
    expect(await screen.findByText('No local analysis runs have been recorded.')).toBeVisible();
    expect(screen.queryByText(/trade executed/i)).not.toBeInTheDocument();
  });

  it('uses compact wide-desktop layout constraints without horizontal overflow rules', () => {
    const stylesheet = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
    expect(stylesheet).toContain('.dashboard-header');
    expect(stylesheet).toContain('grid-template-rows: auto minmax(490px, 1fr) auto');
    expect(stylesheet).toContain('grid-template-rows: repeat(4, max-content)');
    expect(stylesheet).toContain('overflow-x: hidden');
  });

  it('renders every required action fixture through the centralized banner mapping', () => {
    for (const action of ActionSchema.options) {
      render(<App analysisSource={actionFixtures[action]} />);
      const banner = screen.getByLabelText(`Current action: ${getActionState(action).label}`);
      const supportingText = banner.querySelector('.action-banner__reason');

      expect(banner).toBeVisible();
      expect(supportingText).toBeVisible();
      expect(supportingText).not.toHaveTextContent(/^\s*$/);
      cleanup();
    }
  });

  it('allows action-banner supporting text to wrap without clipping', () => {
    const stylesheet = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
    const supportingTextRule = stylesheet.match(/\.action-banner__reason\s*\{([^}]*)\}/)?.[1];

    expect(supportingTextRule).toContain('overflow: visible');
    expect(supportingTextRule).toContain('overflow-wrap: anywhere');
    expect(supportingTextRule).toContain('white-space: normal');
    expect(supportingTextRule).not.toContain('overflow: hidden');
    expect(supportingTextRule).not.toContain('text-overflow: ellipsis');
    expect(supportingTextRule).not.toContain('max-height');
  });

  it('renders the validated approved mock analysis', () => {
    render(<App />);

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'NAS100 H4 Setup Check' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current action: WAIT FOR PULLBACK')).toBeInTheDocument();
    expect(screen.getByTestId('summary-score')).toHaveTextContent('38');
    expect(screen.getByTestId('summary-grade')).toHaveTextContent('D');
    expect(screen.getByTestId('summary-actionability')).toHaveTextContent('Below premium threshold');
    expect(screen.queryByTestId('summary-score')).not.toHaveTextContent('74');
  });

  it('presents calculated pullback messaging and unavailable plan values without fixture fallbacks', () => {
    render(<App />);

    expect(screen.getByText('Entry: Waiting for pullback location.')).toBeVisible();
    expect(screen.getByText('Stop: Not calculated. Targets: Not calculated. R:R: Not available.')).toBeVisible();
    expect(screen.queryByText('Stop 28,820')).not.toBeInTheDocument();
    expect(screen.queryByText('Target 1 29,220')).not.toBeInTheDocument();
  });

  it('renders support, resistance, preferred-entry, and current-price markers from data', () => {
    render(<App />);

    expect(screen.getAllByTestId('support-zone')).toHaveLength(2);
    expect(screen.getAllByTestId('resistance-zone')).toHaveLength(2);
    expect(screen.getByTestId('preferred-entry-zone')).toHaveAccessibleName(
      'Preferred long pullback zone, 28,880 to 28,920',
    );
    expect(within(screen.getByTestId('current-price-marker')).getByText('29,082')).toBeVisible();
  });

  it('uses safe fallback copy when optional narrative text is missing', () => {
    render(<App analysisSource={missingNarrativeFixture} />);

    expect(screen.getByText('No additional setup rationale was provided.')).toBeVisible();
    expect(screen.getByText('No additional next-step guidance was provided.')).toBeVisible();
    expect(screen.getByText('No additional market context was provided.')).toBeVisible();
  });

  it('shows WAIT FOR NEXT 4H CLOSE when an open candle fixture requests BUY', () => {
    render(<App analysisSource={openCandleFixture} candleSource={openCandleDatasetFixture} />);

    expect(screen.getByLabelText('Current action: WAIT FOR NEXT 4H CLOSE')).toBeVisible();
    expect(screen.queryByLabelText('Current action: BUY')).not.toBeInTheDocument();
    expect(screen.getByText('An open H4 candle cannot authorize an entry.')).toBeVisible();
    expect(screen.getByTestId('latest-candle-status')).toHaveTextContent('Open H4 - unconfirmed');
  });

  it('keeps the dashboard available but withholds an invalid candle chart', () => {
    render(<App candleSource={invalidCandleDatasetFixture} />);

    expect(screen.getByTestId('dashboard')).toBeVisible();
    expect(screen.getByTestId('chart-error-state')).toBeVisible();
    expect(screen.queryByTestId('financial-chart')).not.toBeInTheDocument();
  });

  it('shows NO TRADE and a stale badge for stale market data', () => {
    render(<App analysisSource={staleDataFixture} />);

    expect(screen.getByLabelText('Current action: NO TRADE')).toBeVisible();
    expect(screen.getAllByText('Stale data').length).toBeGreaterThan(0);
    expect(screen.getByText('The latest market data is stale.')).toBeVisible();
  });

  it('withholds the dashboard and renders a safe error state for invalid JSON data', () => {
    render(<App analysisSource={invalidAnalysisFixture} />);

    expect(screen.getByTestId('error-state')).toBeVisible();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('does not embed approved mock analysis values in presentation component source', () => {
    const componentSource = readSourceTree(join(process.cwd(), 'src', 'components'));

    for (const forbiddenValue of ['29082', '28880', '28920', '29220', '29400']) {
      expect(componentSource).not.toContain(forbiddenValue);
    }
  });
});
