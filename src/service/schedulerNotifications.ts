import notifier from 'node-notifier';

import type { SchedulerRunResult } from './scheduler/fixtureScheduler';

const TITLE = 'NAS100 Swing Dashboard';

/** Purely informational — never implies "act now" or authorizes an entry, matching the same
 * rule already applied to the Patience Filter and the report narrative. */
const messageFor = (result: SchedulerRunResult): string | null => {
  switch (result.outcome) {
    case 'created':
      return 'New OANDA H4 report ready — open the dashboard to review.';
    case 'blocked':
      return 'Scheduled run could not confirm the expected H4 candle — no new report this time.';
    case 'failed':
      return 'Scheduled run failed — check the connection or service.';
    case 'already_exists':
      return null;
  }
};

export const notifySchedulerOutcome = (result: SchedulerRunResult): void => {
  const message = messageFor(result);
  if (!message) return;
  notifier.notify({ title: TITLE, message, sound: false });
};
