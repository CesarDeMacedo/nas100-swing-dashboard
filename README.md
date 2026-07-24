# NAS100 Swing Intelligence Dashboard

The NAS100 Swing Intelligence Dashboard is a decision-support interface for reviewing structured NAS100 swing-trading analysis.

## Current Status

Completed through the local synthetic scheduler milestone.

- Deterministic strategy engine implemented.
- The dashboard and Markdown report use the same calculated `DashboardState`.
- 192 tests currently pass.
- The dashboard and scheduler remain synthetic; manual OANDA reports are local-only and read-only.
- The application has no trade execution capability.

- Primary instrument: NAS100
- Architecture direction: local-first TypeScript

## Local Manual Service

`npm run service` starts a local-only Node service at `http://127.0.0.1:4310`. It opens the SQLite repository only when the service starts and never executes trades.

For local workflow validation, start `npm run service` first, then run `npm run dev` for the dashboard. Set `VITE_NAS100_SERVICE_URL` only when the service uses a different local URL.

- `GET /health` reports local persistence and scheduler availability.
- `POST /runs/manual-fixture` runs the validated synthetic fixture pipeline and persists one immutable completed report.
- `GET /runs?limit=20` lists recent runs; `GET /runs/:runKey` returns a stored immutable run and report.
- Repeating the same fixture run returns the existing run rather than creating a duplicate.
- `NAS100_DASHBOARD_DB_PATH` overrides the SQLite path; `NAS100_DASHBOARD_PORT` overrides the port; `NAS100_DASHBOARD_SCHEDULER_ENABLED=false` disables scheduled fixture runs.

The dashboard includes a compact, read-only Analysis history overlay that loads local records only when opened. It requires `npm run service`, does not alter fixture dashboard values, and does not create new analysis runs.

## OANDA Read-Only Provider Foundation

Create an OANDA Practice account in the OANDA portal, generate a personal API token there, and place it only in a local `.env` file based on `.env.example`. Never place tokens in browser settings, source files, logs, or Git.

- `OANDA_ENVIRONMENT=practice` or `live` (defaults to `practice`)
- `OANDA_ACCOUNT_ID`
- `OANDA_API_TOKEN`
- `OANDA_NAS100_INSTRUMENT` is optional until its exact account-supported symbol is verified.

`npm run service` loads the project-root `.env` file when the Node service starts; already-set operating-system environment variables take precedence. Then call `GET http://127.0.0.1:4310/providers/oanda/status` to inspect safe configuration state. `POST /providers/oanda/verify` performs one read-only instrument-list check and returns NAS100/US100 candidates without selecting one. After explicitly setting a verified `OANDA_NAS100_INSTRUMENT`, `GET /providers/oanda/candles?count=250` returns normalized midpoint H4 candles only.

OANDA data is not connected to the dashboard or scheduler. Manual OANDA reports use the deterministic report pipeline and local persistence only; the service uses GET-only OANDA requests and has no order, trade, or account-modification capability.

`POST /runs/manual-oanda` requests 250 OANDA midpoint H4 candles and 250 Daily candles, keeping the completed datasets separate: H4 serves structure and decisions; Daily serves Daily Regime only. Open candles are excluded and both source timestamps are saved with the immutable local report. It is manual and read-only; cross-market and event-risk data remain unavailable, so it cannot authorize an entry. The dashboard still defaults to mock data, the scheduler remains synthetic and unchanged, and no trades can be executed.

New OANDA reports calculate deterministic completed-H4 support, resistance, preferred-entry, and informational invalidation levels with ATR-based buffers. Existing local reports remain immutable. Saved OANDA reports can be opened from Analysis History in the dashboard (see below).

Saved OANDA reports that include a display snapshot can be reviewed in the dashboard as historical saved analysis, not live streaming. Mock data remains the default after refresh; the scheduler and automatic OANDA loading remain unchanged.

The scheduler defaults to synthetic fixture mode. Set `NAS100_DASHBOARD_SCHEDULER_PROVIDER=oanda` only for an explicit read-only OANDA opt-in while `npm run service` is active; Toronto slots are unchanged and cross-market/event-risk inputs remain unavailable.

When viewing a saved OANDA analysis, the dashboard can observe local server-relayed OANDA v20 pricing-stream updates and the open H4 candle. This is observation-only: decisions continue to use the saved completed-candle report, and the browser never connects to OANDA directly.

The dashboard also provides an on-demand, read-only OANDA H4 chart preview. It renders local-service candle data only and does not run strategy analysis.

The shared candlestick chart supports mouse-wheel zoom, drag-to-pan, price-scale adjustment, double-click scale reset, pinch zoom, and an explicit Reset view. Saved OANDA metadata is shown compactly near the chart; mock data remains the default after refresh.

## Local Synthetic Scheduler

While `npm run service` is running, the in-process scheduler evaluates `America/Toronto` time every 15 seconds and runs only these one-minute post-close slots: Monday-Friday at 1:01 p.m., and Sunday-Friday at 9:01 p.m. It skips Saturday and the Sunday 1:01 p.m. slot.

Each slot runs the same deterministic synthetic fixture pipeline used by the manual control. The latest H4 candle must be explicitly completed before an immutable completed report can be saved. SQLite run-key uniqueness makes repeated attempts idempotent, including a restart during the same scheduled minute. This is local-only synthetic validation; live market data is not implemented for the fixture path.

The dashboard remains driven by synthetic fixture data. The header control only saves the existing deterministic fixture analysis locally.

Both the OANDA scheduler and the manual OANDA run now fetch live cross-market H4 confirmation for US500, US30, and Russell 2000 (same OANDA account, no separate provider) and classify each as confirming/contradicting/neutral against NAS100's own H4 structure; event-risk data remains unavailable, so BUY/SELL stays blocked regardless. Scheduler outcomes (`created`/`blocked`/`failed`) trigger a local, informational-only OS notification via `node-notifier` — see `src/service/schedulerNotifications.ts`.

`node-notifier` pulls in a transitive `uuid` dependency flagged by `npm audit` (moderate severity) for a buffer-bounds issue that only applies when a caller passes an explicit `buf` argument to `uuid` — `node-notifier` never does this, it only generates random UUIDs. `npm audit fix --force` would downgrade `node-notifier` to `6.0.0` to resolve it, which is a real regression for an exposure that does not apply here, so this finding is accepted as-is rather than fixed.

Next planned milestones: event-risk data, PNG export, and Windows packaging (see `docs/IMPLEMENTATION_PLAN.md` phases 11-13, 15).
