# MVP Checklist

## Current delivered workflow

- [x] Manual read-only OANDA H4/Daily analysis with completed-candle safety and immutable saved snapshots.
- [x] Eligible saved OANDA reports open in the main dashboard; refresh defaults to mock data.
- [x] On-demand read-only OANDA H4 Chart Preview.
- [x] Chart zoom, pan, price-scale adjustment, pinch zoom, double-click reset, and explicit Reset view.
- [x] Optional OANDA scheduler mode remains explicitly opt-in; fixture remains the default.
- [x] Experimental live OANDA observation lifecycle is validated: shared-subscriber, reconnect/backoff, H4 rollover, saved-candle immutability, and saved-report invariance all have passing regression tests (`src/service/liveStream.test.ts`). The feature remains opt-in and is still labeled experimental pending broader real-world use.

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
- [x] Phase 6: Provider-confirmed closed status is required after each 13:01 and 21:01 `America/Toronto` scheduled run (open candles excluded end to end; see `src/service/oandaRun.test.ts`, `src/service/scheduler/fixtureScheduler.test.ts`).
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
- [x] Phase 9: Priority runs occur at 13:01 and 21:01 `America/Toronto` (`src/service/scheduler/fixtureScheduler.test.ts`, including DST-boundary cases).
- [ ] Phase 10: History is stored locally with immutable report JSON and queryable summaries. SQLite storage and the `GET /runs`/`GET /runs/:runKey` query API are implemented and tested; a dedicated history search/filter screen and retention policy are not yet built (tracked as a follow-up).
- [x] Phase 10: SQLite migrations and restart persistence tests pass (`src/persistence/analysisRepository.test.ts`).

## Local product operations

- [ ] Phase 11: Local notifications are opt-in, deduplicated, and logged.
- [ ] Phase 12: PNG export is generated from a rendered data-bound 16:9 view.
- [ ] Phase 12: Exported PNG values match the source report and contain no reference-image pixels.
- [ ] Phase 13: Provider adapter validates symbol mapping, timestamps, freshness, and health.
- [ ] Phase 13: US500 and US30 are primary confirmation; Russell 2000 is complementary.
- [ ] Phase 14: Data-health error states explain blocked action and never display stale data as actionable.
- [ ] Phase 15: Windows package preserves local history and works with mock data offline.
- [ ] Phase 16: Optional AI explanation cannot change deterministic numeric facts or action.

## MVP exit criteria

- [ ] Dashboard matches the approved visual direction without using either reference image in the interface.
- [x] Chart uses structured OHLC data rather than an illustrative chart image.
- [ ] Dashboard and report remain consistent because both render the same validated analysis report.
- [ ] Completed-candle protection works in unit and end-to-end tests.
- [ ] Patience Filter works and cannot be overridden by Setup Score.
- [ ] Minimum 2:1 reward-to-risk protection works.
- [ ] Stale, missing, or invalid data defaults to NO TRADE.
- [ ] Analysis history is stored locally.
- [ ] Scheduled runs are recorded and duplicate-safe.
- [ ] Local notifications work under user-controlled settings.
- [ ] PNG export works from the rendered dashboard state.
- [ ] No trading execution capability exists in code, dependencies, routes, or UI.
