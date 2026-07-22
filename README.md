# NAS100 Swing Intelligence Dashboard

The NAS100 Swing Intelligence Dashboard is a decision-support interface for reviewing structured NAS100 swing-trading analysis.

## Current Status

Completed through the manual local-service milestone.

- Deterministic strategy engine implemented.
- The dashboard and Markdown report use the same calculated `DashboardState`.
- 178 tests currently pass.
- All market data remains synthetic.
- The application has no trade execution capability.

- Primary instrument: NAS100
- Architecture direction: local-first TypeScript

## Local Manual Service

`npm run service` starts a local-only Node service at `http://127.0.0.1:4310`. It opens the SQLite repository only when the service starts and never executes trades.

For local workflow validation, start `npm run service` first, then run `npm run dev` for the dashboard. Set `VITE_NAS100_SERVICE_URL` only when the service uses a different local URL.

- `GET /health` reports local persistence availability.
- `POST /runs/manual-fixture` runs the validated synthetic fixture pipeline and persists one immutable completed report.
- `GET /runs?limit=20` lists recent runs; `GET /runs/:runKey` returns a stored run and report.
- Repeating the same fixture run returns the existing run rather than creating a duplicate.
- `NAS100_DASHBOARD_DB_PATH` overrides the SQLite path; `NAS100_DASHBOARD_PORT` overrides the port.

Scheduling is not implemented. The browser dashboard has no history UI yet.

The dashboard remains driven by synthetic fixture data. The header control only saves the existing deterministic fixture analysis locally.

Next planned milestone: scheduled runs and market-data provider evaluation.
