// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-notifier', () => ({ default: { notify: vi.fn() } }));

import notifier from 'node-notifier';
import { notifySchedulerOutcome } from './schedulerNotifications';

afterEach(() => vi.mocked(notifier.notify).mockClear());

describe('notifySchedulerOutcome', () => {
  it('notifies informatively for created, blocked, and failed outcomes', () => {
    notifySchedulerOutcome({ outcome: 'created', runKey: 'k' });
    notifySchedulerOutcome({ outcome: 'blocked', runKey: 'k' });
    notifySchedulerOutcome({ outcome: 'failed', runKey: 'k' });

    expect(notifier.notify).toHaveBeenCalledTimes(3);
    const messages = vi.mocked(notifier.notify).mock.calls.map(([payload]) => String((payload as { message: string }).message));
    for (const message of messages) {
      expect(message).not.toMatch(/\benter\b|\bbuy\b|\bsell\b|act now/i);
    }
  });

  it('never notifies for already_exists, since nothing changed', () => {
    notifySchedulerOutcome({ outcome: 'already_exists', runKey: 'k' });

    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
