# Changelog

## Saved OANDA Live Observation

- Added local SSE observation of live OANDA price and open H4 candle only while reviewing a saved OANDA analysis.
- Saved reports, scheduler, and persistence remain unchanged; open candles are not used for decisions.

## Optional OANDA Scheduler Mode

- Added explicit `NAS100_DASHBOARD_SCHEDULER_PROVIDER=oanda` opt-in; fixture scheduling remains the default.
- OANDA runs reuse the read-only manual pipeline and existing Toronto slots with safe scheduler health status.

## Saved OANDA Dashboard Review

- Added session-only viewing of supported saved OANDA report snapshots from Analysis History in the existing dashboard layout, with server-relayed OANDA v20 pricing-stream observation for the open H4 candle.
- This is historical saved analysis, not streaming; mock remains the refresh default and scheduler behavior is unchanged.

## Deterministic OANDA Market Levels

- New manual OANDA reports derive immutable completed-H4 swing support, resistance, preferred-entry, and informational invalidation levels with ATR-based buffers.
- Cross-market and event-risk remain unavailable; dashboard selection of OANDA reports remains deferred.

## OANDA Multi-Timeframe Data Foundation

- Manual OANDA analysis now fetches and validates separate H4 and Daily midpoint candle datasets; open candles are excluded from both.
- H4 remains the execution/run identity while Daily is used only for Daily Regime metadata; cross-market and event-risk remain unavailable.
- The dashboard remains mock-backed and the scheduler remains synthetic and unchanged.

## Manual OANDA Analysis Run

- Added a manual, read-only `POST /runs/manual-oanda` path that requests 250 OANDA H4 midpoint candles, excludes open candles, and saves immutable completed-candle reports locally.
- Cross-market confirmation and event-risk data remain explicitly unavailable, so OANDA reports cannot authorize an entry.
- The dashboard and synthetic scheduler remain unchanged; no trading capability was added.

## OANDA Read-Only Provider Foundation

- Added environment-only OANDA v20 configuration, GET-only account instrument discovery, candidate matching, and normalized midpoint H4 candle retrieval.
- Added local provider status, verification, and explicit-instrument candle endpoints with no credential exposure.
- OANDA data remains disconnected from dashboard, scheduler, strategy, SQLite persistence, and any trading capability.

## Local Synthetic Scheduler

- Added an in-process `America/Toronto` scheduler for the approved Monday-Friday 13:01 and Sunday-Friday 21:01 fixture slots.
- Reused the deterministic fixture pipeline and SQLite run-key idempotency, with completed-candle protection and scheduler status in health.
- No notifications, live data, browser polling, or trade execution behavior was added.

## Read-Only Analysis History

- Added a compact dashboard overlay for local persisted analysis history and immutable report detail.
- History loads on demand, supports manual refresh, and leaves the fixture dashboard state unchanged.
- No scheduler, live data, or trade execution behavior was added.

## Browser Manual-Run Control

- Added a typed native-fetch client for the local analysis service and a compact dashboard header control.
- The control reports local availability and manual fixture persistence results without changing the calculated fixture dashboard state.
- Added localhost Vite CORS/preflight support; no scheduler or history UI was added.

## Manual Local Service

- Added a localhost-only manual fixture service with health, run creation, history, and run lookup endpoints.
- Reuses the deterministic dashboard/report pipeline and persists immutable reports through `AnalysisRepository`.
- Added run-key idempotency and temporary SQLite service tests; scheduling remains unimplemented.

## Local persistence foundation

- Added a local SQLite repository for immutable analysis reports and analysis-run records.
- Added transactional persistence, unique run-key protection, durable reopening, and repository tests.
- Kept persistence disconnected from the browser dashboard, scheduling, notifications, live data, AI, and packaging.

## Phase 8C Checkpoint

- Completed the deterministic NAS100 strategy and report pipeline through Phase 8C.
- Dashboard and Markdown report now share the calculated `DashboardState`.
- Verified 160 passing tests with synthetic market data only and no trade execution capability.
- Added an on-demand read-only OANDA H4 chart preview; it does not run strategy analysis.
- Chart navigation and saved-OANDA layout were stabilized: pan/zoom state is preserved, Reset view is explicit, and saved provenance is compactly presented. Live OANDA observation remains experimental.
- Chart navigation and saved-OANDA layout were stabilized: pan/zoom state is preserved, Reset view is explicit, and saved provenance is compactly presented. Live OANDA observation remains experimental.
