# NAS100 Swing Intelligence Dashboard

The NAS100 Swing Intelligence Dashboard is a decision-support interface for reviewing structured NAS100 swing-trading analysis.

## Current Status

Completed through Phase 8C.

- Deterministic strategy engine implemented.
- The dashboard and Markdown report use the same calculated `DashboardState`.
- 160 tests currently pass.
- All market data remains synthetic.
- The application has no trade execution capability.

- Primary instrument: NAS100
- Architecture direction: local-first TypeScript

Next planned milestone: persistence, scheduled runs, and market-data provider evaluation.
