# MVP Checklist

## Current delivered workflow

- [x] Manual read-only OANDA H4/Daily analysis with completed-candle safety and immutable saved snapshots.
- [x] Eligible saved OANDA reports open in the main dashboard; on startup the dashboard auto-shows the most recently saved OANDA report (local lookup only), falling back to mock data when unavailable or none exists.
- [x] A manual "Run OANDA analysis now" header button runs `POST /runs/manual-oanda` on demand (dedup-aware, disabled while in flight) and immediately switches the dashboard to the resulting saved analysis, without a separate History → "View in dashboard" step.
- [x] On-demand read-only OANDA H4 Chart Preview.
- [x] Chart zoom, pan, price-scale adjustment, pinch zoom, double-click reset, and explicit Reset view.
- [x] Optional OANDA scheduler mode remains explicitly opt-in; fixture remains the default.
- [x] Experimental live OANDA observation lifecycle is validated: shared-subscriber, reconnect/backoff, H4 rollover, saved-candle immutability, and saved-report invariance all have passing regression tests (`src/service/liveStream.test.ts`). The feature remains opt-in and is still labeled experimental pending broader real-world use.
- [x] Scheduled OANDA runs retry with backoff on transient network errors or a stale/not-yet-available H4 candle, without ever accepting data from the wrong H4 window (C4, `src/service/scheduledOandaRun.test.ts`).
- [x] Live cross-market H4 confirmation (US500, US30, Russell 2000) is fetched from the existing OANDA account and classified against NAS100's own H4 structure (A1, `src/service/oandaRun.test.ts`).
- [x] Scheduler outcomes trigger a local, informational-only OS notification via `node-notifier`; the test suite never triggers a real notification (A5, `src/service/schedulerNotifications.test.ts`, `src/service/scheduler/fixtureScheduler.test.ts`).
- [ ] An event-risk data source is wired, but only as a validation spike (unofficial Forex Factory feed, A2) — not a resolved production provider. Entry authorization is no longer hard-blocked on it (ADR-018, explicit user decision) — the trader weighs it manually.
- [x] A dedicated regression test proves the OANDA pipeline authorizes a live BUY end to end once a full realistic setup lines up, in place of the former test that proved the now-removed entry-authorization clamp held one back (`src/service/oandaRun.test.ts`, ADR-018).

## Configurable strategies and backtest harness (ADR-017)

- [x] Trade-plan/patience-filter/strategy-decision/setup-score/scored-decision functions accept an optional resolved strategy-parameters argument, defaulting to today's exact hardcoded values (`src/domain/strategyParameters.ts`); proven byte-identical to omitting the argument by a dedicated equality test (`src/application/buildDashboardState.test.ts`), not just "existing tests still pass."
- [x] Strategies are named, versioned, and immutable once `active` (`draft -> active -> archived`), persisted in `strategy_configs` (`src/persistence/analysisRepository.ts`).
- [x] Minimum R:R >= 2.0 and Setup Score weights summing to exactly 100 are enforced by shared Zod validation at the single write path, proven by a test that calls `POST /strategies` directly (bypassing the UI) and asserts HTTP 422 (`src/service/server.strategies.test.ts`).
- [x] A persisted run records which strategy/version produced it (`analysis_runs.strategy_config_id`), denormalized onto `GET /runs`/`GET /runs/:runKey` responses so Analysis History can show it without an extra client fetch.
- [x] An isolated CLI backtest harness (`scripts/backtest/`) replays the real, unmodified decision pipeline against OANDA historical candles (H4 + Daily for NAS100, H4 for the three cross-market instruments), with a zero-lookahead guarantee proven by a dedicated test (`scripts/backtest/__tests__/replayWindow.noLookahead.test.ts`) rather than asserted by convention.
- [x] Each hypothetical signal is walked forward through an explicit fill/outcome state machine (pending -> filled/cancelled -> win/loss/unresolved) with a documented, conservative same-candle tie-break rule (`scripts/backtest/signalOutcome.ts`, `signalOutcome.test.ts`).
- [x] Backtest results (win rate, planned vs. realized R:R, expectancy, breakdown by hour/weekday) persist to a separate SQLite file from production and are served read-only by the running service (`GET /backtests`, `GET /backtests/:id`).
- [x] New "Strategies" and "Backtests" dashboard pages (overlay panels, matching the existing Analysis History pattern) for managing strategy versions and viewing backtest results; a "Run backtest" control builds the CLI command rather than triggering it over HTTP, keeping the harness isolated from the production service.
- [ ] No live or scheduled run selects a non-default strategy yet — the resolved-strategy pipeline is wired and tested, but only the backtest harness currently passes an explicit strategy. Wiring an `active` strategy into `runManualOandaAnalysis`/the scheduler is a follow-up.
- [ ] Event-risk history is out of scope for this first backtest version; the replay always treats event-risk as clear (`eventRisk: []`). Historical event-risk replay is a follow-up, tracked in `docs/DECISIONS.md`.

## Foundation

- [x] Phase 0: Browser-first TypeScript workspace and React/Vite app are created after approval; the deferred Node local service is intentionally not created.
- [x] Phase 0: Tailwind, Zustand, Zod, Vitest, React Testing Library, ESLint, and Prettier are configured; Playwright remains deferred to its approved later testing phase.
- [x] Phase 0: Typecheck and smoke tests pass on a clean local install.

## Dashboard and chart

- [x] Phase 1: Dashboard renders the existing mock analysis through a typed Zod boundary.
- [x] Phase 1: The approved template image is not loaded as an application asset, background, or chart image.
- [x] Phase 1: All required action states render from fixtures with no hardcoded market facts in components.
- [x] Phase 1: Desktop layout follows the approved 16:9 visual direction and responsive fallback rules are implemented.
- [x] Phase 2: Chart uses structured OHLC candles, price scale, time scale, crosshair, and report-derived zones.
- [x] Phase 2: Support, resistance, entry, invalidation, stop, target, and decision overlays are mapped from validated fixtures.

## Data and deterministic analysis

- [x] Phase 3: Zod rejects invalid reports before dashboard rendering.
- [x] Phase 3: Report and candle schemas use version `1.0.0`; unsupported versions are rejected safely.
- [x] Phase 3: Enums, timestamps, zones, data health, event risk, cross-market context, settings, and score breakdown have centralized runtime contracts.
- [x] Phase 3: Normalization canonicalizes representation without inventing price, score, indicator, or candle-completion facts.
- [x] Phase 3: Open candle, stale data, invalid health, missing event risk, sub-2.0 R:R, and missing-target input cannot authorize BUY or SELL.
- [x] Phase 4: EMA, RSI, ATR, and insufficient-history behavior have known-value tests (`src/domain/indicators.test.ts`, `indicatorSnapshot.test.ts`).
- [x] Phase 5: Daily regime and H4 structure classification return evidence and reason codes (`src/domain/dailyRegime.test.ts`, `h4Structure.test.ts`, `technicalContext.test.ts`).
- [x] Phase 6: Completed-candle protection prevents BUY and SELL from an open H4 candle (`src/domain/patienceFilter.test.ts`, `strategyDecision.test.ts`, enforced again at the OANDA boundary in `src/service/oandaRun.test.ts`).
- [x] Phase 6: Provider-confirmed closed status is required after each of the six scheduled `America/Toronto` runs (01:01, 05:01, 09:01, 13:01, 17:01, 21:01) (open candles excluded end to end; see `src/service/oandaRun.test.ts`, `src/service/scheduler/fixtureScheduler.test.ts`).
- [x] Phase 6: Stale market data defaults to NO TRADE (`src/domain/patienceFilter.test.ts`, `src/domain/analysis.test.ts`).
- [x] Phase 6: Missing macro or event-risk data defaults to WAIT or NO TRADE (`src/domain/patienceFilter.test.ts`, `src/domain/strategyDecision.test.ts`).
- [x] Phase 6: Patience Filter blocks action independently of Setup Score (`src/domain/patienceFilter.test.ts`, `scoredDecision.test.ts`).
- [x] Phase 6: Estimated R:R below 2:1 blocks BUY and SELL (`src/domain/tradePlan.test.ts`, `src/domain/patienceFilter.test.ts`).
- [x] Phase 7: Setup Score category totals are reproducible, capped, and cannot override a hard gate (`src/domain/setupScore.test.ts`).
- [x] Phase 7: Grade bands match D/C/C+/B/A/A+ approved thresholds (`src/domain/setupScore.test.ts`).
- [x] Phase 7: A score-70+ WAIT state may show a premium setup card without authorizing entry (`src/domain/scoredDecision.test.ts`).

## Report, scheduler, and history

- [x] Phase 8: Dashboard and report have automated parity tests for action, score, prices, levels, and guidance (`src/application/buildSwingReport.test.ts`).
- [x] Phase 8: Position sizing remains explicitly illustrative and cannot execute a trade (no execution capability exists anywhere in the codebase; see ADR-008).
- [x] Phase 9: Manual and scheduled runs share one analysis path (`src/service/server.ts` scheduler `run` callback calls the same `executeManualOandaAnalysis`/`runSyntheticFixtureAnalysis` used by the manual routes).
- [x] Phase 9: Scheduled runs are deduplicated by completed candle and recorded (`src/service/scheduler/fixtureScheduler.test.ts`, run-key uniqueness in `src/persistence/analysisRepository.test.ts`).
- [x] Phase 9: Priority runs occur six times daily at 01:01, 05:01, 09:01, 13:01, 17:01, and 21:01 `America/Toronto` (`src/service/scheduler/fixtureScheduler.test.ts`, including DST-boundary cases).
- [x] Phase 10: History is stored locally with immutable report JSON and queryable summaries. SQLite storage, the `GET /runs`/`GET /runs/:runKey` query API, and a client-side search/filter + adjustable record-count selector in `AnalysisHistoryPanel` are implemented and tested. A formal retention/back-up policy is not yet defined (tracked as a follow-up); run deletion/pruning is deliberately not implemented (would touch the immutable-records rule).
- [x] Phase 10: SQLite migrations and restart persistence tests pass (`src/persistence/analysisRepository.test.ts`).

## Local product operations

- [ ] Phase 11: Local notifications are opt-in, deduplicated, and logged. Implemented at a smaller scope: `node-notifier` fires on every scheduler outcome (`created`/`blocked`/`failed`) with no user-configurable opt-in thresholds, dedup, or audit log beyond existing SQLite history (`src/service/schedulerNotifications.test.ts`).
- [ ] Phase 12: PNG export is generated from a rendered data-bound 16:9 view. Implemented at a smaller scope: the H4 chart panel itself exports as PNG on demand (client-side, `takeScreenshot()`), not a dedicated 16:9 setup-card view with metadata manifest.
- [x] Phase 12: Exported PNG values match the source report and contain no reference-image pixels (the export is a direct canvas screenshot of the already-rendered, report-driven chart).
- [x] Phase 13: Provider adapter validates symbol mapping, timestamps, freshness, and health for NAS100 and cross-market instruments (`src/providers/oanda/oandaProvider.test.ts`, `src/service/oandaRun.test.ts`).
- [x] Phase 13: US500 and US30 are primary confirmation; Russell 2000 is complementary (`src/domain/setupScore.ts`, `src/domain/patienceFilter.ts`, live-wired in `src/service/oandaRun.ts`'s cross-market classification).
- [ ] Phase 14: Data-health error states explain blocked action and never display stale data as actionable. A passive OANDA configuration-status badge exists (`OandaStatusBadge`) as a modest starting point; the full failure-state matrix, manual retry, and error history are not implemented.
- [ ] Phase 15: Windows package preserves local history and works with mock data offline.
- [ ] Phase 16: Optional AI explanation cannot change deterministic numeric facts or action.

## MVP exit criteria

- [ ] Dashboard matches the approved visual direction without using either reference image in the interface.
- [x] Chart uses structured OHLC data rather than an illustrative chart image.
- [x] Dashboard and report remain consistent because both render the same validated analysis report (`src/application/buildSwingReport.test.ts`).
- [x] Completed-candle protection works in unit and end-to-end tests (`src/domain/patienceFilter.test.ts`, `src/service/oandaRun.test.ts`, `src/service/scheduler/fixtureScheduler.test.ts`).
- [x] Patience Filter works and cannot be overridden by Setup Score (`src/domain/scoredDecision.test.ts`).
- [x] Minimum 2:1 reward-to-risk protection works (`src/domain/tradePlan.test.ts`, `src/domain/patienceFilter.test.ts`).
- [x] Stale, missing, or invalid data defaults to NO TRADE (`src/domain/analysis.test.ts`, `src/domain/patienceFilter.test.ts`).
- [x] Analysis history is stored locally (`src/persistence/analysisRepository.test.ts`).
- [x] Scheduled runs are recorded and duplicate-safe (`src/service/scheduler/fixtureScheduler.test.ts`).
- [ ] Local notifications work under user-controlled settings (notifications fire, but there are no user-controlled settings yet — see Phase 11 above).
- [x] PNG export works from the rendered dashboard state (chart panel only — see Phase 12 above).
- [x] No trading execution capability exists in code, dependencies, routes, or UI (ADR-008).
