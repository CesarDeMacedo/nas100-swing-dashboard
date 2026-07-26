// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-notifier', () => ({ default: { notify: vi.fn() } }));

import notifier from 'node-notifier';
import type { StoredMeanReversionEvaluation } from '../persistence/analysisRepository';
import { notifyMeanReversionEvaluation, notifySchedulerOutcome } from './schedulerNotifications';

afterEach(() => vi.mocked(notifier.notify).mockClear());

const evaluation = (
  overrides: Partial<StoredMeanReversionEvaluation> = {},
): StoredMeanReversionEvaluation => ({
  id: 'eval-1',
  strategyConfigId: 'strategy:1',
  strategyId: 'strategy',
  version: 1,
  instrument: 'NAS100_USD',
  timeframe: 'D',
  evaluatedAt: '2026-07-21T21:01:00.000Z',
  referenceCandleTime: '2026-07-21T21:00:00.000Z',
  referenceClose: 100,
  signal: 'FLAT',
  stopPrice: null,
  exitWatchPrice: null,
  atr: null,
  smaFilterValue: null,
  aboveSmaFilter: null,
  riskPerTradePct: 0.73,
  accountSize: null,
  suggestedRiskAmount: null,
  suggestedPositionSizeUnits: null,
  persistedAt: '2026-07-21T21:01:01.000Z',
  ...overrides,
});

describe('notifySchedulerOutcome', () => {
  it('notifies informatively for created, blocked, and failed outcomes', () => {
    notifySchedulerOutcome({ outcome: 'created', runKey: 'k' });
    notifySchedulerOutcome({ outcome: 'blocked', runKey: 'k' });
    notifySchedulerOutcome({ outcome: 'failed', runKey: 'k' });

    expect(notifier.notify).toHaveBeenCalledTimes(3);
    const messages = vi
      .mocked(notifier.notify)
      .mock.calls.map(([payload]) => String((payload as { message: string }).message));
    for (const message of messages) {
      expect(message).not.toMatch(/\benter\b|\bbuy\b|\bsell\b|act now/i);
    }
  });

  it('never notifies for already_exists, since nothing changed', () => {
    notifySchedulerOutcome({ outcome: 'already_exists', runKey: 'k' });

    expect(notifier.notify).not.toHaveBeenCalled();
  });
});

describe('notifyMeanReversionEvaluation', () => {
  it('notifies on ENTER and EXIT with the signal and stop in the message', () => {
    notifyMeanReversionEvaluation(evaluation({ signal: 'ENTER', stopPrice: 95.5 }));
    notifyMeanReversionEvaluation(evaluation({ signal: 'EXIT', stopPrice: null }));

    expect(notifier.notify).toHaveBeenCalledTimes(2);
    const messages = vi
      .mocked(notifier.notify)
      .mock.calls.map(([payload]) => String((payload as { message: string }).message));
    expect(messages[0]).toMatch(/ENTER/);
    expect(messages[0]).toMatch(/95\.50/);
    expect(messages[1]).toMatch(/EXIT/);
  });

  it('never notifies for HOLD or FLAT, only persisting them', () => {
    notifyMeanReversionEvaluation(evaluation({ signal: 'HOLD' }));
    notifyMeanReversionEvaluation(evaluation({ signal: 'FLAT' }));

    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
