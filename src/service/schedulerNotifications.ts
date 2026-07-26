import notifier from 'node-notifier';

import type { StoredMeanReversionEvaluation } from '../persistence/analysisRepository';
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

/** Purely informational, same rule as `notifySchedulerOutcome`: never implies "act now". Fires
 * only on ENTER/EXIT — HOLD/FLAT are persisted (see AnalysisRepository.saveMeanReversionEvaluation)
 * but never notified, per the plan. */
export const notifyMeanReversionEvaluation = (evaluation: StoredMeanReversionEvaluation): void => {
  if (evaluation.signal !== 'ENTER' && evaluation.signal !== 'EXIT') return;
  const stopText = evaluation.stopPrice === null ? '' : ` | stop ${evaluation.stopPrice.toFixed(2)}`;
  const message = `${evaluation.instrument} ${evaluation.timeframe} strategy ${evaluation.strategyId.slice(0, 8)} v${evaluation.version}: ${evaluation.signal} @ ${evaluation.referenceClose.toFixed(2)}${stopText}`;
  notifier.notify({ title: TITLE, message, sound: false });
};
