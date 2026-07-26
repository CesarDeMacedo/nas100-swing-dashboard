import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';

import App from './App';
import type {
  HistoryResult,
  LocalAnalysisServiceClient,
  ManualRunResult,
  RunDetailResult,
} from './serviceClient/localAnalysisService';
import {
  actionFixtures,
  invalidAnalysisFixture,
  invalidCandleDatasetFixture,
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
  const client = (
    checkHealth: LocalAnalysisServiceClient['checkHealth'],
    runManualFixture: LocalAnalysisServiceClient['runManualFixture'],
    listRecentRuns: LocalAnalysisServiceClient['listRecentRuns'] = async () => ({
      kind: 'empty',
      runs: [],
    }),
    getRunByKey: LocalAnalysisServiceClient['getRunByKey'] = async () => ({
      kind: 'failed',
      message: 'not selected',
    }),
    extra: Partial<LocalAnalysisServiceClient> = {},
  ): LocalAnalysisServiceClient => ({
    checkHealth,
    runManualFixture,
    listRecentRuns,
    getRunByKey,
    ...extra,
  });
  const historyItem = {
    run: {
      id: 'run-1',
      runKey: 'fixture-run',
      completedAt: '2026-07-22T01:01:00.000Z',
      status: 'COMPLETED',
      source: 'fixture',
      persistedAt: '2026-07-22T01:01:01.000Z',
      reportId: 'report-1',
    },
    report: {
      action: 'WAIT_FOR_PULLBACK',
      direction: 'long',
      score: 38,
      grade: 'D',
      sourceCandleTime: '2026-07-22T01:00:00.000Z',
      isActionable: false,
    },
  };
  const secondHistoryItem = {
    run: {
      id: 'run-2',
      runKey: 'fixture-run-2',
      completedAt: '2026-07-22T05:01:00.000Z',
      status: 'COMPLETED',
      source: 'fixture',
      persistedAt: '2026-07-22T05:01:01.000Z',
      reportId: 'report-2',
    },
    report: {
      action: 'SELL',
      direction: 'short',
      score: 82,
      grade: 'A',
      sourceCandleTime: '2026-07-22T05:00:00.000Z',
      isActionable: true,
    },
  };
  const historyDetail: RunDetailResult = {
    kind: 'succeeded',
    item: historyItem,
    report: {
      ...historyItem.report,
      primaryReason: 'Pullback location is pending.',
      entryTrigger: null,
      stopPrice: null,
      targets: [],
      estimatedRewardRisk: null,
    },
  };

  it('renders local service health and preserves the fixture dashboard while offline', async () => {
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'unavailable', message: 'offline' }),
          async () => ({ kind: 'failed', message: 'offline' }),
        )}
      />,
    );

    expect(await screen.findByText('Service unavailable')).toBeVisible();
    expect(
      screen.getByText('Start the local analysis service to enable manual persistence.'),
    ).toBeVisible();
    expect(screen.getByTestId('dashboard')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run mock analysis' })).toBeDisabled();
  });

  it('renders successful and duplicate fixture persistence without changing the dashboard action', async () => {
    const runManualFixture = vi
      .fn()
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({
        ...run,
        kind: 'already_exists' as const,
        run: { ...run.run, alreadyExists: true },
      });
    render(<App serviceClient={client(async () => ({ kind: 'available' }), runManualFixture)} />);

    const button = await screen.findByRole('button', { name: 'Run mock analysis' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(await screen.findByText('Mock analysis saved')).toBeVisible();

    fireEvent.click(button);
    expect(await screen.findByText('Mock analysis already recorded')).toBeVisible();
  });

  it('renders failed and malformed manual-run states without execution language', async () => {
    const malformed: ManualRunResult = {
      kind: 'malformed_response',
      message: 'Local service returned an invalid manual-run response.',
    };
    const runManualFixture = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'failed' as const,
        message: 'Manual analysis could not be saved.',
      })
      .mockResolvedValueOnce(malformed);
    render(<App serviceClient={client(async () => ({ kind: 'available' }), runManualFixture)} />);

    const button = await screen.findByRole('button', { name: 'Run mock analysis' });
    fireEvent.click(button);
    expect(await screen.findByText('Could not save mock analysis')).toBeVisible();
    fireEvent.click(button);
    expect(await screen.findByText('Could not save mock analysis')).toBeVisible();
    expect(screen.queryByText(/trade executed/i)).not.toBeInTheDocument();
  });

  it('runs a manual OANDA analysis on demand, reusing the same runKey dedup surfaced as already_exists', async () => {
    const oandaRun: ManualRunResult = {
      kind: 'succeeded',
      run: { ...run.run, runKey: 'oanda-run', alreadyExists: false },
    };
    const runManualOanda = vi
      .fn()
      .mockResolvedValueOnce(oandaRun)
      .mockResolvedValueOnce({
        ...oandaRun,
        kind: 'already_exists' as const,
        run: { ...oandaRun.run, alreadyExists: true },
      });
    const checkOandaStatus: LocalAnalysisServiceClient['checkOandaStatus'] = async () => ({
      kind: 'configured',
      environment: 'practice',
      configuredInstrument: true,
    });
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          undefined,
          undefined,
          { checkOandaStatus, runManualOanda },
        )}
      />,
    );

    const button = await screen.findByRole('button', { name: 'Run OANDA analysis now' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(await screen.findByText('OANDA analysis run saved.')).toBeVisible();
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(
      await screen.findByText('Already analyzed this H4 candle — no new run needed.'),
    ).toBeVisible();
    expect(runManualOanda).toHaveBeenCalledTimes(2);
  });

  it('shows the just-run OANDA analysis on the dashboard immediately, without opening history', async () => {
    const oandaRun: ManualRunResult = {
      kind: 'succeeded',
      run: {
        ...run.run,
        runKey: 'oanda-v20:NAS100_USD:H4:2026-07-22T00:00:00.000Z:1.0.0:1.0.0',
        alreadyExists: false,
      },
    };
    const runManualOanda = vi.fn().mockResolvedValue(oandaRun);
    const savedAnalysis = structuredClone(actionFixtures.WAIT) as Record<string, unknown>;
    Object.assign(savedAnalysis, {
      id: 'saved-oanda-manual',
      instrument: 'NAS100_USD',
      displayName: 'NAS100_USD',
      dataProvider: 'OANDA v20',
      currentPrice: 30123,
    });
    const snapshot = {
      provider: 'oanda-v20' as const,
      environment: 'practice' as const,
      instrument: 'NAS100_USD',
      timeframe: 'H4' as const,
      candles: [
        {
          time: '2026-07-22T00:00:00.000Z',
          open: 30100,
          high: 30140,
          low: 30080,
          close: 30123,
          isClosed: true,
          instrument: 'NAS100_USD',
          timeframe: 'H4',
          source: 'oanda-v20',
        },
      ],
      analysis: savedAnalysis,
      h4SourceCandleTime: '2026-07-22T00:00:00.000Z',
      dailySourceCandleTime: null,
      warnings: [],
    };
    const detail: RunDetailResult = {
      kind: 'succeeded',
      item: historyItem,
      report: { ...historyDetail.report, displaySnapshot: snapshot },
    };
    const getRunByKey = vi
      .fn<LocalAnalysisServiceClient['getRunByKey']>()
      .mockResolvedValue(detail);
    const checkOandaStatus: LocalAnalysisServiceClient['checkOandaStatus'] = async () => ({
      kind: 'configured',
      environment: 'practice',
      configuredInstrument: true,
    });
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          undefined,
          getRunByKey,
          { checkOandaStatus, runManualOanda },
        )}
      />,
    );

    const button = await screen.findByRole('button', { name: 'Run OANDA analysis now' });
    fireEvent.click(button);

    expect(
      await screen.findByText('OANDA PRACTICE — SAVED ANALYSIS', {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByTestId('current-price-marker')).toHaveTextContent('30,123');
    expect(getRunByKey).toHaveBeenCalledWith(oandaRun.run.runKey);
  });

  it('ignores a second click on the OANDA run button while the first request is still in flight', async () => {
    let resolveRun: (value: ManualRunResult) => void = () => {};
    const runManualOanda = vi.fn(
      () =>
        new Promise<ManualRunResult>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const checkOandaStatus: LocalAnalysisServiceClient['checkOandaStatus'] = async () => ({
      kind: 'configured',
      environment: 'practice',
      configuredInstrument: true,
    });
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          undefined,
          undefined,
          { checkOandaStatus, runManualOanda },
        )}
      />,
    );

    const button = await screen.findByRole('button', { name: 'Run OANDA analysis now' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    resolveRun({
      kind: 'succeeded',
      run: { ...run.run, runKey: 'oanda-run', alreadyExists: false },
    });
    await screen.findByText('OANDA analysis run saved.');

    expect(runManualOanda).toHaveBeenCalledTimes(1);
  });

  it('does not offer the OANDA run button when OANDA is not configured', async () => {
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
        )}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Run mock analysis' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Run OANDA analysis now' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the compact mock-service utility separate from the title flow', async () => {
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
        )}
      />,
    );

    const control = await screen.findByLabelText('Synthetic local analysis service');
    const title = screen.getByRole('heading', { name: 'NAS100 H4 Setup Check' });
    expect(control).toHaveAttribute('title', 'Synthetic fixture persistence only');
    expect(title.closest('.dashboard-title-block')).not.toContainElement(control);
    expect(control).toHaveTextContent('Service online');
  });

  it('opens, refreshes, selects, and closes read-only local analysis history', async () => {
    const listRecentRuns = vi
      .fn<LocalAnalysisServiceClient['listRecentRuns']>()
      .mockResolvedValue({ kind: 'succeeded', runs: [historyItem] } as HistoryResult);
    const getRunByKey = vi
      .fn<LocalAnalysisServiceClient['getRunByKey']>()
      .mockResolvedValue(historyDetail);
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          listRecentRuns,
          getRunByKey,
        )}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Open analysis history' }));
    expect(await screen.findByRole('dialog', { name: 'Analysis history' })).toBeVisible();
    const historyDialog = await screen.findByRole('dialog', { name: 'Analysis history' });
    expect(within(historyDialog).getByText('WAIT FOR PULLBACK')).toBeVisible();
    fireEvent.click(within(historyDialog).getByRole('button', { name: /WAIT FOR PULLBACK/ }));
    expect(await screen.findByText('Pullback location is pending.')).toBeVisible();
    expect(screen.getAllByText('Not calculated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    // 1 (startup auto-load check for a saved OANDA report to show by default) + 1 (opening
    // history) + 1 (this refresh click) — historyItem's runKey isn't an OANDA one, so
    // auto-load finds nothing to switch to, but it still calls listRecentRuns once on mount.
    expect(listRecentRuns).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Analysis history' })).not.toBeInTheDocument();
  });

  it('filters local analysis history client-side and reloads with a chosen record limit', async () => {
    const listRecentRuns = vi
      .fn<LocalAnalysisServiceClient['listRecentRuns']>()
      .mockResolvedValue({
        kind: 'succeeded',
        runs: [historyItem, secondHistoryItem],
      } as HistoryResult);
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          listRecentRuns,
        )}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Open analysis history' }));
    const historyDialog = await screen.findByRole('dialog', { name: 'Analysis history' });
    expect(within(historyDialog).getByText('WAIT FOR PULLBACK')).toBeVisible();
    expect(within(historyDialog).getByText('SELL')).toBeVisible();

    fireEvent.change(
      within(historyDialog).getByRole('searchbox', { name: 'Filter local analysis history' }),
      { target: { value: 'short' } },
    );
    expect(within(historyDialog).queryByText('WAIT FOR PULLBACK')).not.toBeInTheDocument();
    expect(within(historyDialog).getByText('SELL')).toBeVisible();

    // Typing the human-readable label (with spaces) must match the underlying enum
    // value (with underscores) — this is what a user actually sees and types.
    fireEvent.change(
      within(historyDialog).getByRole('searchbox', { name: 'Filter local analysis history' }),
      { target: { value: 'wait for pullback' } },
    );
    expect(within(historyDialog).getByText('WAIT FOR PULLBACK')).toBeVisible();
    expect(within(historyDialog).queryByText('SELL')).not.toBeInTheDocument();

    fireEvent.change(
      within(historyDialog).getByRole('searchbox', { name: 'Filter local analysis history' }),
      { target: { value: 'no such record' } },
    );
    expect(within(historyDialog).getByText('No records match this filter.')).toBeVisible();

    fireEvent.change(
      within(historyDialog).getByRole('combobox', { name: 'Number of records to load' }),
      { target: { value: '50' } },
    );
    expect(listRecentRuns).toHaveBeenLastCalledWith(50);
  });

  it('fills the gap between a saved snapshot and now with completed candles fetched on open', async () => {
    const savedAnalysis = structuredClone(actionFixtures.WAIT) as Record<string, unknown>;
    Object.assign(savedAnalysis, {
      id: 'saved-oanda-gap',
      instrument: 'NAS100_USD',
      displayName: 'NAS100_USD',
      dataProvider: 'OANDA v20',
      currentPrice: 30123,
    });
    const snapshot = {
      provider: 'oanda-v20' as const,
      environment: 'practice' as const,
      instrument: 'NAS100_USD',
      timeframe: 'H4' as const,
      candles: [
        {
          time: '2026-07-22T00:00:00.000Z',
          open: 30000,
          high: 30050,
          low: 29950,
          close: 30020,
          isClosed: true,
          instrument: 'NAS100_USD',
          timeframe: 'H4',
          source: 'oanda-v20',
        },
      ],
      analysis: savedAnalysis,
      h4SourceCandleTime: '2026-07-22T00:00:00.000Z',
      dailySourceCandleTime: null,
      warnings: [],
    };
    const detail: RunDetailResult = {
      kind: 'succeeded',
      item: historyItem,
      report: { ...historyDetail.report, displaySnapshot: snapshot },
    };
    const getOandaCandles = vi.fn().mockResolvedValue({
      kind: 'succeeded',
      data: {
        provider: 'oanda-v20',
        environment: 'practice',
        instrument: 'NAS100_USD',
        timeframe: 'H4',
        candles: [
          // Same time as the saved snapshot's own candle — must not be double-counted.
          {
            time: '2026-07-22T00:00:00.000Z',
            open: 30000,
            high: 30050,
            low: 29950,
            close: 30020,
            isClosed: true,
            instrument: 'NAS100_USD',
            timeframe: 'H4',
            source: 'oanda-v20',
          },
          // Two candles that closed after the snapshot was taken — these were the ones missing.
          {
            time: '2026-07-22T04:00:00.000Z',
            open: 30020,
            high: 30080,
            low: 30000,
            close: 30060,
            isClosed: true,
            instrument: 'NAS100_USD',
            timeframe: 'H4',
            source: 'oanda-v20',
          },
          {
            time: '2026-07-22T08:00:00.000Z',
            open: 30060,
            high: 30100,
            low: 30040,
            close: 30090,
            isClosed: true,
            instrument: 'NAS100_USD',
            timeframe: 'H4',
            source: 'oanda-v20',
          },
          // Currently open — must be excluded from the gap fill.
          {
            time: '2026-07-22T12:00:00.000Z',
            open: 30090,
            high: 30110,
            low: 30070,
            close: 30100,
            isClosed: false,
            instrument: 'NAS100_USD',
            timeframe: 'H4',
            source: 'oanda-v20',
          },
        ],
      },
    });
    const serviceClient: LocalAnalysisServiceClient = {
      ...client(
        async () => ({ kind: 'available' }),
        async () => run,
        async () => ({ kind: 'succeeded', runs: [historyItem] }),
        async () => detail,
      ),
      getOandaCandles,
    };
    render(<App serviceClient={serviceClient} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open analysis history' }));
    const historyDialog = await screen.findByRole('dialog', { name: 'Analysis history' });
    fireEvent.click(within(historyDialog).getByRole('button', { name: /WAIT FOR PULLBACK/ }));
    fireEvent.click(
      await within(historyDialog).findByRole('button', { name: 'View in dashboard' }),
    );

    expect(getOandaCandles).toHaveBeenCalledWith(250);
    // 1 saved candle + 2 gap candles (the duplicate and the open one excluded) = 3 total.
    await waitFor(() => {
      expect(screen.getByTestId('latest-candle-summary')).toHaveTextContent(
        '3 saved OANDA candles',
      );
    });
  });

  it('opens a saved OANDA snapshot in the dashboard and returns to mock data without provider calls', async () => {
    const savedAnalysis = structuredClone(actionFixtures.WAIT) as Record<string, unknown>;
    Object.assign(savedAnalysis, {
      id: 'saved-oanda-analysis',
      instrument: 'NAS100_USD',
      displayName: 'NAS100_USD',
      dataProvider: 'OANDA v20',
      currentPrice: 30123,
      supportZones: [
        {
          id: 'saved-support',
          type: 'SUPPORT',
          low: 30000,
          high: 30020,
          label: 'Saved support',
          source: 'OANDA H4',
          confidence: 70,
          lockedByUser: false,
        },
      ],
      resistanceZones: [
        {
          id: 'saved-resistance',
          type: 'RESISTANCE',
          low: 30200,
          high: 30220,
          label: 'Saved resistance',
          source: 'OANDA H4',
          confidence: 70,
          lockedByUser: false,
        },
      ],
      preferredEntryZone: {
        id: 'saved-entry',
        type: 'ENTRY',
        low: 30000,
        high: 30020,
        label: 'Saved entry',
        source: 'OANDA H4',
        confidence: 70,
        lockedByUser: false,
      },
    });
    const snapshot = {
      provider: 'oanda-v20' as const,
      environment: 'practice' as const,
      instrument: 'NAS100_USD',
      timeframe: 'H4' as const,
      candles: [
        {
          time: '2026-07-22T00:00:00.000Z',
          open: 30100,
          high: 30140,
          low: 30080,
          close: 30123,
          isClosed: true,
          instrument: 'NAS100_USD',
          timeframe: 'H4',
          source: 'oanda-v20',
        },
      ],
      analysis: savedAnalysis,
      h4SourceCandleTime: '2026-07-22T00:00:00.000Z',
      dailySourceCandleTime: null,
      warnings: ['Saved only.'],
    };
    const detail: RunDetailResult = {
      kind: 'succeeded',
      item: historyItem,
      report: { ...historyDetail.report, displaySnapshot: snapshot },
    };
    const listRecentRuns = async () => ({ kind: 'succeeded' as const, runs: [historyItem] });
    const getRunByKey = async () => detail;
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          listRecentRuns,
          getRunByKey,
        )}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Open analysis history' }));
    const historyDialog = await screen.findByRole('dialog', { name: 'Analysis history' });
    fireEvent.click(within(historyDialog).getByRole('button', { name: /WAIT FOR PULLBACK/ }));
    fireEvent.click(
      await within(historyDialog).findByRole('button', { name: 'View in dashboard' }),
    );

    expect(screen.queryByRole('dialog', { name: 'Analysis history' })).not.toBeInTheDocument();
    expect(
      await screen.findByText('OANDA PRACTICE — SAVED ANALYSIS', {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByTestId('current-price-marker')).toHaveTextContent('30,123');
    expect(screen.getAllByTestId('support-zone')).toHaveLength(1);
    expect(screen.getByText(/saved OANDA candles/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to mock dashboard' }));
    expect(screen.queryByText('OANDA PRACTICE — SAVED ANALYSIS')).not.toBeInTheDocument();
    expect(await screen.findByTestId('current-price-marker')).toHaveTextContent('29,082');
  });

  it('shows the most recently saved OANDA report on startup instead of mock, without any click', async () => {
    const savedAnalysis = structuredClone(actionFixtures.WAIT) as Record<string, unknown>;
    Object.assign(savedAnalysis, {
      id: 'saved-oanda-auto',
      instrument: 'NAS100_USD',
      displayName: 'NAS100_USD',
      dataProvider: 'OANDA v20',
      currentPrice: 30123,
    });
    const snapshot = {
      provider: 'oanda-v20' as const,
      environment: 'practice' as const,
      instrument: 'NAS100_USD',
      timeframe: 'H4' as const,
      candles: [
        {
          time: '2026-07-22T00:00:00.000Z',
          open: 30100,
          high: 30140,
          low: 30080,
          close: 30123,
          isClosed: true,
          instrument: 'NAS100_USD',
          timeframe: 'H4',
          source: 'oanda-v20',
        },
      ],
      analysis: savedAnalysis,
      h4SourceCandleTime: '2026-07-22T00:00:00.000Z',
      dailySourceCandleTime: null,
      warnings: [],
    };
    // Only a real OANDA run (runKey prefixed oanda-v20:) is eligible for startup auto-load —
    // this is what distinguishes it from an ordinary fixture-run history entry.
    const oandaHistoryItem = {
      run: {
        id: 'run-oanda-1',
        runKey: 'oanda-v20:NAS100_USD:H4:2026-07-22T00:00:00.000Z:1.0.0:1.0.0',
        completedAt: '2026-07-22T01:01:00.000Z',
        status: 'COMPLETED',
        source: 'manual',
        persistedAt: '2026-07-22T01:01:01.000Z',
        reportId: 'report-oanda-1',
      },
      report: {
        action: 'WAIT',
        direction: 'none',
        score: 38,
        grade: 'D',
        sourceCandleTime: '2026-07-22T00:00:00.000Z',
        isActionable: false,
      },
    };
    const detail: RunDetailResult = {
      kind: 'succeeded',
      item: oandaHistoryItem,
      report: { ...historyDetail.report, displaySnapshot: snapshot },
    };
    const listRecentRuns = vi
      .fn<LocalAnalysisServiceClient['listRecentRuns']>()
      .mockResolvedValue({ kind: 'succeeded', runs: [oandaHistoryItem] } as HistoryResult);
    const getRunByKey = vi
      .fn<LocalAnalysisServiceClient['getRunByKey']>()
      .mockResolvedValue(detail);
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          listRecentRuns,
          getRunByKey,
        )}
      />,
    );

    expect(
      await screen.findByText('OANDA PRACTICE — SAVED ANALYSIS', {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByTestId('current-price-marker')).toHaveTextContent('30,123');
    expect(getRunByKey).toHaveBeenCalledWith(oandaHistoryItem.run.runKey);
  });

  it('keeps showing mock on startup when no OANDA report has ever been saved, only fixture runs', async () => {
    const listRecentRuns = vi
      .fn<LocalAnalysisServiceClient['listRecentRuns']>()
      .mockResolvedValue({ kind: 'succeeded', runs: [historyItem] } as HistoryResult);
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          listRecentRuns,
        )}
      />,
    );

    await waitFor(() => expect(listRecentRuns).toHaveBeenCalled());
    expect(screen.queryByText('OANDA PRACTICE — SAVED ANALYSIS')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-price-marker')).toHaveTextContent('29,082');
  });

  it('does not auto-load a saved OANDA report while the local service is unavailable', async () => {
    const listRecentRuns = vi.fn<LocalAnalysisServiceClient['listRecentRuns']>();
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'unavailable', message: 'offline' }),
          async () => ({ kind: 'failed', message: 'offline' }),
          listRecentRuns,
        )}
      />,
    );

    expect(await screen.findByText('Service unavailable')).toBeVisible();
    expect(listRecentRuns).not.toHaveBeenCalled();
    expect(screen.getByTestId('current-price-marker')).toHaveTextContent('29,082');
  });

  it('shows empty and failed history states without execution wording', async () => {
    const empty = async () => ({ kind: 'empty' as const, runs: [] as [] });
    render(
      <App
        serviceClient={client(
          async () => ({ kind: 'available' }),
          async () => run,
          empty,
        )}
      />,
    );
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

  // PrimaryActionBanner is no longer rendered by App (the pipeline strategy's action display
  // was removed from the default dashboard — see AnalysisSidebar/Dashboard); the underlying
  // action-to-label mapping this used to exercise end-to-end is still fully covered by
  // domain/actionStates.test.ts, and the CSS-wrapping check below only reads styles.css
  // directly, so it remains valid for the component even while unmounted.
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
  });

  it('exports the chart as a downloaded PNG without contacting any server', async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export PNG' }));

    expect(clickSpy).toHaveBeenCalledOnce();
    clickSpy.mockRestore();
  });

  it('does not show stale stop/target chart markers when the calculated plan is unavailable', () => {
    render(<App />);

    expect(screen.queryByText('Stop 28,820')).not.toBeInTheDocument();
    expect(screen.queryByText('Target 1 29,220')).not.toBeInTheDocument();
  });

  it('renders support, resistance, preferred-entry, and current-price markers from data', async () => {
    render(<App />);

    expect(await screen.findAllByTestId('support-zone')).toHaveLength(2);
    expect(screen.getAllByTestId('resistance-zone')).toHaveLength(2);
    expect(screen.getByTestId('preferred-entry-zone')).toHaveAccessibleName(
      'Preferred long pullback zone, 28,880 to 28,920',
    );
    expect(within(screen.getByTestId('current-price-marker')).getByText('29,082')).toBeVisible();
  });

  // The fallback copy this used to check ("No additional setup rationale...", etc.) belonged
  // to WhyNoEntryCard/NextActionCard/MarketContextCard, all removed from the default view (see
  // AnalysisSidebar) — nothing on the dashboard renders that narrative text anymore.

  it('shows the open-candle badge when the latest candle is unconfirmed', async () => {
    render(<App analysisSource={openCandleFixture} candleSource={openCandleDatasetFixture} />);

    // The safety property this used to assert directly on screen — an open H4 candle must
    // never authorize BUY/SELL, only WAIT_FOR_NEXT_4H_CLOSE — is no longer shown on the
    // dashboard (PrimaryActionBanner removed) but remains fully covered at the domain level in
    // buildDashboardState.test.ts using this exact fixture. What's left worth checking here is
    // the chart's own open-candle indicator.
    expect(await screen.findByTestId('latest-candle-status')).toHaveTextContent(
      'Open H4 - unconfirmed',
    );
  });

  it('keeps the dashboard available but withholds an invalid candle chart', async () => {
    render(<App candleSource={invalidCandleDatasetFixture} />);

    expect(screen.getByTestId('dashboard')).toBeVisible();
    expect(await screen.findByTestId('chart-error-state')).toBeVisible();
    expect(screen.queryByTestId('financial-chart')).not.toBeInTheDocument();
  });

  it('shows a stale-data badge for stale market data', () => {
    render(<App analysisSource={staleDataFixture} />);

    expect(screen.getAllByText('Stale data').length).toBeGreaterThan(0);
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
