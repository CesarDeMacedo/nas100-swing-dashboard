import type { EventRisk, EventRiskSeverity } from '../schemas';
import { withTimeout } from './withTimeout';

/**
 * A2 spike (see docs/DECISIONS.md "Unresolved decisions"): an unofficial, undocumented feed
 * widely used by hobby trading tools. No auth, no key, but no uptime/format guarantee either
 * — this is deliberately not a production commitment, just the cheapest way to get real
 * event-risk data flowing to observe whether it changes the computed decision at all before
 * investing in a paid/stable provider (Financial Modeling Prep, Trading Economics, ...).
 */
export const FOREX_FACTORY_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const IMPACT_TO_SEVERITY: Record<string, EventRiskSeverity | undefined> = {
  High: 'HIGH',
  Medium: 'MEDIUM',
  Low: 'LOW',
};

/** Provisional: how close (in either direction) a High-impact USD event must be to "now"
 * to actually block entry, versus just being informational. Event-blocking thresholds are
 * explicitly unresolved (ADR-014) — this is a placeholder for the spike, not a final rule. */
const BLOCKING_WINDOW_MS = 60 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const normalizeEvent = (raw: unknown, now: Date): EventRisk | null => {
  if (!isRecord(raw)) return null;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : null;
  const country = typeof raw.country === 'string' ? raw.country : null;
  const dateValue = typeof raw.date === 'string' ? raw.date : null;
  const impact = typeof raw.impact === 'string' ? raw.impact : null;
  if (!title || !country || !dateValue || !impact) return null;
  if (country !== 'USD') return null;
  const eventTimeMs = Date.parse(dateValue);
  if (Number.isNaN(eventTimeMs)) return null;
  const severity = IMPACT_TO_SEVERITY[impact];
  if (!severity) return null; // Holiday / unrecognized impact label — not relevant to blocking.

  const withinBlockingWindow = Math.abs(eventTimeMs - now.getTime()) <= BLOCKING_WINDOW_MS;
  const blocksEntry = severity === 'HIGH' && withinBlockingWindow;
  return {
    status: 'AVAILABLE',
    severity: blocksEntry ? 'BLOCKING' : severity,
    eventName: title,
    eventTime: new Date(eventTimeMs).toISOString(),
    source: 'forex-factory-spike',
    freshness: 'FRESH',
    blocksEntry,
    notes: [`A2 spike, provisional methodology: ${impact}-impact USD event ${withinBlockingWindow ? 'within +/-60min of the analysis time' : 'outside the +/-60min window'}.`],
  };
};

/** Best-effort, single-attempt, timeout-bounded fetch of this week's USD High/Medium-impact
 * events. Returns `null` on any failure — network error, timeout, non-200, malformed JSON, or
 * a payload that isn't an array — so the caller can fall back to the existing UNAVAILABLE
 * event-risk placeholder exactly as it does today. Never throws. */
export const fetchForexFactoryEventRisk = async (fetcher: typeof fetch = fetch, now: Date = new Date(), timeoutMs = 8000): Promise<EventRisk[] | null> => {
  const response = await withTimeout(fetcher(FOREX_FACTORY_CALENDAR_URL, { headers: { Accept: 'application/json' } }), timeoutMs);
  if (!response || !response.ok) return null;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(payload)) return null;
  const events = payload.map((raw) => normalizeEvent(raw, now)).filter((event): event is EventRisk => event !== null);
  return events;
};
