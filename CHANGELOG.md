# Changelog

## Safety-Clamp Regression Proof

- Added a dedicated test constructing a fully realistic scenario (confirmed bullish H4 pullback, cross-market CONFIRMING, clean event-risk, R:R >= 2.0) where the underlying pipeline genuinely computes `BUY`, then asserts the OANDA pipeline's `runManualOandaAnalysis` still returns WAIT.
- Verified by temporarily bypassing the safety clamp and confirming the test fails with the real `BUY` leaking through, then reverting — the same discipline already used for the C4/A1/A2 timeout tests.

## Event-Risk Validation Spike (A2)

- Added a Forex Factory event-risk adapter (`src/service/forexFactoryEventRisk.ts`): unofficial, undocumented feed, no auth, wired as a validation spike to observe whether real event-risk data changes computed decisions, not as a production provider commitment.
- Fail-safe by construction: any network error, timeout, non-200, malformed JSON, or non-array payload degrades to "not fetched," falling back to the existing UNAVAILABLE placeholder exactly as before this feature.
- BUY/SELL remains unconditionally blocked by the existing OANDA-pipeline safety clamp regardless of what this spike returns; only the clamp's now-inaccurate "event-risk unavailable" wording was corrected.

## Live Cross-Market Confirmation (A1)

- Both the manual and scheduled OANDA paths now fetch live H4 candles for US500, US30, and Russell 2000 from the existing OANDA account (no new provider needed — confirmed via a one-off account-instrument check) and classify each as confirming/contradicting/neutral against NAS100's own H4 structure.
- Fetches are best-effort, timeout-bounded, and outside the C4 window-retry loop: a failure or hang for one cross-market instrument degrades only that instrument to UNAVAILABLE, it never blocks or retries the NAS100 run.
- BUY/SELL remains unconditionally blocked by the existing OANDA-pipeline safety clamp regardless of cross-market confirmation.

## Scheduler Outcome Notifications (A5)

- Added a local OS notification (`node-notifier`) for every scheduler-evaluated slot outcome — `created`, `blocked`, or `failed` — via `src/service/schedulerNotifications.ts`.
- Messages are purely informational ("new report ready," "could not confirm the expected candle," "run failed") and never imply an entry action.
- The test suite always injects a no-op notify hook, so it never triggers a real OS notification.

## Scheduled OANDA Retry/Backoff (C4)

- The scheduler's OANDA fetch now retries with backoff (`[2000, 5000, 10000]` ms, configurable) on a transient network error or a stale/not-yet-available H4 candle.
- The expected H4 window is captured once at the start of the retry sequence and never recomputed mid-retry, so a retry can never silently accept data from the wrong window; a candle from a newer window than expected aborts immediately instead of retrying.
- Exhausted retries now persist a real `FAILED` run (previously only held in memory, lost on restart). The manual `/runs/manual-oanda` endpoint and `OandaClient`/`OandaProvider` remain single-attempt and untouched.

## PNG Chart Export

- Added on-demand PNG export of the H4 chart panel using `lightweight-charts`' native screenshot capability; client-side only, no server involvement.
- Modest scope: exports the chart panel itself, not a dedicated 16:9 setup-card export view with metadata manifest.

## Analysis History Search and Record Count

- Added a client-side text filter (action/direction/status/run key) and an adjustable record-count selector (10/25/50/100) to the Analysis History panel, reusing the existing `GET /runs?limit=` capability.
- Both are read-only; run deletion/pruning remains deliberately out of scope.

## OANDA Status Badge

- Added a passive `OandaStatusBadge` in the dashboard header surfacing OANDA configuration status (not configured / invalid / unavailable / healthy) once the local service is confirmed available, without requiring a manual OANDA action first.

## Scheduler Failure Tracking and Live-Stream Hardening

- Added an in-memory `consecutiveFailures` counter to scheduler status, incremented on each failed run and reset on any other outcome.
- Fixed two live-stream bugs found during lifecycle testing: a late-subscriber replay gap and a reconnect-backoff bypass.
- Fixed a display-only gap where opening a saved OANDA analysis skipped completed H4 candles between the saved snapshot and the current open candle.

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
