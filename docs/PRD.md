# NAS100 Swing Intelligence Dashboard

## 1. Product summary

NAS100 Swing Intelligence Dashboard is a local-first, read-only decision-support application for evaluating NAS100 swing setups on completed 4-hour candles. It combines deterministic technical analysis, cross-market context, structured reports, and a premium 16:9 dashboard inspired by the approved visual template.

The application must never execute trades.

## 2. Goals

- Show the current NAS100 Daily and H4 market regime.
- Render real OHLC candles and technical levels from structured data.
- Apply explicit, auditable swing-strategy rules.
- Produce a consistent action: BUY, SELL, WAIT, WAIT FOR PULLBACK, or NO TRADE.
- Calculate a transparent Setup Score and grade.
- Refresh after each completed H4 candle, approximately every four hours.
- Preserve a history of analyses and outcomes.
- Generate a full text report and an exportable 16:9 setup card.

## 3. Non-goals for the MVP

- Automated trading or broker order placement.
- Portfolio execution, leverage management, or financial advice.
- Fully autonomous news interpretation.
- Cloud deployment as a requirement.
- Perfect replication of an OANDA/TradingView chart image.

## 4. Target user

A discretionary swing trader who wants a repeatable, explainable NAS100 review before considering a trade.

## 5. Core workflow

Market data → completed-candle detection → indicators → strategy rules → cross-market checks → score → structured analysis JSON → dashboard and report → history and optional notification.

The dashboard and report must consume the same validated analysis object so that prices, levels, score, action, and narrative cannot diverge.

## 6. MVP scope

### Current Setup screen

- Dark navy/black premium financial-dashboard layout.
- Large H4 candlestick chart on the left.
- Stacked analysis cards on the right.
- Prominent action banner.
- Score, grade, regime, status, and bias.
- Support, resistance, invalidation, entry, stop, and target levels.
- Bottom metrics strip for RSI, ATR, trend, volatility, and freshness.
- Dynamic states: BUY, SELL, WAIT, NO TRADE, WAIT FOR PULLBACK, WAIT FOR NEXT 4H CLOSE.

### Full Report screen

- Daily regime and H4 structure.
- Cross-market confirmation.
- Macro/Fed context.
- Market drivers.
- Earnings and event risk.
- Long and short scenarios.
- Patience filter.
- Position sizing examples.
- Cancellation conditions.
- Setup Score and final decision.

### Setup History screen

Store timestamp, instrument, score, action, entry zone, stop, targets, and eventual outcome.

### Settings screen

Allow editing of risk percentage, score threshold, EMA periods, RSI limits, minimum reward-to-risk, instruments, H4 schedule, ATR limits, and first-retest rules. User-locked levels must not be overwritten by automatic refreshes.

## 7. Strategy rules

The first implementation must be deterministic and testable.

### Daily regime

- Bullish when EMA20 > EMA50 > EMA200.
- Bearish when EMA20 < EMA50 < EMA200.
- Otherwise neutral or transitional.

### H4 setup

Evaluate EMA alignment/crosses, pullback location, candle confirmation, RSI, ATR distance, support/resistance, and market confirmation.

### Entry gate

An actionable setup requires completed-candle confirmation, acceptable location, aligned cross-market evidence, and estimated reward-to-risk of at least 2:1. Otherwise action must remain WAIT or NO TRADE.

### Risk

Display illustrative 0.25% conservative and 0.50% standard account-risk scenarios. Never submit orders.

## 8. Setup Score

Initial weighted categories:

| Category           | Maximum |
| ------------------ | ------: |
| Daily Trend        |      20 |
| H4 Structure       |      20 |
| Cross Confirmation |      15 |
| Macro Alignment    |      20 |
| Event Risk         |      10 |
| Entry Quality      |      15 |
| **Total**          | **100** |

Initial display rule: scores below 70 should not generate a premium setup card. Scores of 70 or higher may generate the card, subject to data freshness and validation.

## 9. Data model

Use a Zod-validated `Analysis` object containing at minimum: id, generatedAt, completedCandleAt, provider, freshness, instrument, timeframe, regime, structure, bias, status, action, score, grade, confidence, currentPrice, candles, indicators, support zones, resistance zones, preferred entry, trigger, invalidation, stop, targets, estimatedRR, reason, risks, next steps, market context, and event context.

## 10. Data sources

Use provider adapters so the application can begin with mock data and later support a licensed market-data provider. Initial proxies may include QQQ for NAS100, SPY for US500, DIA for US30, IWM for Russell 2000, VIX, DXY, US10Y, WTI, and a semiconductor ETF. Provider selection, licensing, latency, timezone, and symbol mapping must be documented before live use.

## 11. Refresh and scheduling

The local service should identify the latest completed H4 candle, avoid duplicate processing, fetch required data, run the analysis, persist the result, and notify the UI. The dashboard may poll or use local WebSocket/SSE while open. A background scheduler is preferred for later phases; the MVP may use manual refresh and mock data.

## 12. Technical direction

- React, Vite, TypeScript, and Tailwind CSS.
- Node.js local service.
- SQLite for history.
- Zod for runtime validation.
- Zustand or equivalent lightweight state management.
- Lightweight Charts or equivalent for OHLC rendering.
- PNG export generated from the rendered dashboard, not from AI-generated chart artwork.

## 13. Visual requirements

Use `design/nas100-dashboard-approved-template-v1.png` as the primary layout reference and `design/nas100-oanda-h4-chart-reference.png` as a chart-behavior reference. Do not use either image as a page background. Rebuild the interface with components and render candles from OHLC data.

Required visual qualities: 16:9 composition, dark navy/black background, orange WAIT treatment, green support zones, red resistance/risk zones, high-contrast typography, readable cards, and a premium financial-dashboard appearance.

## 14. Reliability and safeguards

- Mark stale or missing data clearly.
- Never infer a price when required data is absent.
- Show the completed candle timestamp and provider freshness.
- Keep calculations separate from narrative generation.
- Log each refresh and strategy decision.
- Require explicit user action for any future integration beyond analysis display.

## 15. Acceptance criteria

- App runs locally with documented commands.
- Mock analysis renders the approved dashboard structure.
- Candles are rendered from JSON OHLC data.
- Changing the analysis action changes the UI state without component-level hardcoding.
- Score totals are reproducible and tested.
- Invalid analysis objects are rejected with a visible error.
- Dashboard and full report show identical core values.
- No code path can place or simulate a broker order.
- Refresh history records the analysis timestamp and source.

## 16. Delivery phases

1. Documentation and design-reference setup.
2. Static dashboard shell with mock JSON.
3. Real chart component with mock OHLC data.
4. Indicator calculations.
5. Deterministic strategy engine and score.
6. Market-provider adapter.
7. H4 scheduler and duplicate protection.
8. SQLite history.
9. Full report and PNG export.
10. Local notifications.
11. Optional macro/news AI layer, isolated from core calculations.
12. Windows packaging and startup configuration.

## 17. Open decisions

- Final licensed macro/event-risk data provider (NAS100 and cross-market US500/US30/Russell 2000 are resolved: same OANDA v20 account, no separate provider — see `docs/DECISIONS.md` ADR-014). An unofficial Forex Factory feed is wired as a validation spike only, not a production commitment.
- Exact NAS100 symbol and timezone handling — resolved (`America/Toronto`, explicit `OANDA_NAS100_INSTRUMENT`).
- Whether macro/news data is included in the first live release — a validation spike exists to inform this decision, not yet resolved for production.
- Notification mechanism on Windows — resolved for the notification *library* (`node-notifier`, running from the existing Node service); Windows *packaging* technology (Tauri vs. Electron) remains open, see `docs/DECISIONS.md` ADR-011.
- Backtesting methodology and outcome labels.
