# MVP Checklist

## Current delivered workflow

- [x] Manual read-only OANDA H4/Daily analysis with completed-candle safety and immutable saved snapshots.
- [x] Eligible saved OANDA reports open in the main dashboard; refresh defaults to mock data.
- [x] On-demand read-only OANDA H4 Chart Preview.
- [x] Chart zoom, pan, price-scale adjustment, pinch zoom, double-click reset, and explicit Reset view.
- [x] Optional OANDA scheduler mode remains explicitly opt-in; fixture remains the default.
- [ ] Experimental live OANDA observation lifecycle is not yet fully validated.

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
- [ ] Phase 4: EMA, RSI, ATR, and insufficient-history behavior have known-value tests.
- [ ] Phase 5: Daily regime and H4 structure classification return evidence and reason codes.
- [ ] Phase 6: Completed-candle protection prevents BUY and SELL from an open H4 candle.
- [ ] Phase 6: Provider-confirmed closed status is required after each 13:01 and 21:01 `America/Toronto` scheduled run.
- [ ] Phase 6: Stale market data defaults to NO TRADE.
- [ ] Phase 6: Missing macro or event-risk data defaults to WAIT or NO TRADE.
- [ ] Phase 6: Patience Filter blocks action independently of Setup Score.
- [ ] Phase 6: Estimated R:R below 2:1 blocks BUY and SELL.
- [ ] Phase 7: Setup Score category totals are reproducible, capped, and cannot override a hard gate.
- [ ] Phase 7: Grade bands match D/C/C+/B/A/A+ approved thresholds.
- [ ] Phase 7: A score-70+ WAIT state may show a premium setup card without authorizing entry.

## Report, scheduler, and history

- [ ] Phase 8: Dashboard and report have automated parity tests for action, score, prices, levels, and guidance.
- [ ] Phase 8: Position sizing remains explicitly illustrative and cannot execute a trade.
- [ ] Phase 9: Manual and scheduled runs share one analysis path.
- [ ] Phase 9: Scheduled runs are deduplicated by completed candle and recorded.
- [ ] Phase 9: Priority runs occur at 13:01 and 21:01 `America/Toronto`.
- [ ] Phase 10: History is stored locally with immutable report JSON and queryable summaries.
- [ ] Phase 10: SQLite migrations and restart persistence tests pass.

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
