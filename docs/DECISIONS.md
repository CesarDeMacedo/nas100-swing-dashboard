# Architecture Decisions

## ADR-001: TypeScript end to end

Status: Accepted.

Use TypeScript for React, local service, domain logic, chart adapters, and tests. Zod schemas provide runtime validation and inferred types at boundaries. This reduces drift between the report producer and consumer.

## ADR-002: Browser-first before Windows packaging

Status: Accepted.

Build and test the dashboard in a local browser before packaging. This shortens feedback cycles and keeps packaging concerns from obscuring dashboard, chart, and strategy behavior. Windows packaging is Phase 15.

## ADR-003: Mock data before live APIs

Status: Accepted.

The existing mock report is the initial UI fixture. Live provider work starts only after schemas, chart, safety gates, and failure states have tests. This prevents provider licensing and uptime issues from blocking deterministic product work.

## ADR-004: Deterministic strategy before AI

Status: Accepted.

Indicators, classification, action, Patience Filter, and Setup Score are deterministic, tested code. Optional AI may explain a final validated report later but cannot generate or modify numeric facts, score, action, zones, or mandatory guidance.

## ADR-005: SQLite for local history

Status: Accepted, deferred implementation.

SQLite is the local history store because it supports structured queries, migrations, durability, and offline use. It will be initialized only in Phase 10 after the data contract and scheduler requirements are approved.

## ADR-006: Provider abstraction

Status: Accepted.

Market, cross-market, and event inputs enter through normalized provider interfaces. The first provider is mock. Each live provider has explicit symbol mapping, session/timezone policy, freshness, health, and licensing documentation.

## ADR-007: One shared validated report object

Status: Accepted.

The dashboard, full report, history, notification summary, and PNG export all consume the same Zod-validated `AnalysisReport`. This is the source of truth for values and narrative. Derived UI formatting is allowed; independent facts are not.

## ADR-008: No automated trading

Status: Accepted, non-negotiable.

The application is read-only decision support. It has no broker order endpoints, trade execution, account control, or simulated execution capability. Future integrations remain analysis display only unless this decision is explicitly replaced through a new ADR.

## ADR-009: TradingView Lightweight Charts as the initial chart library

Status: Accepted and implemented in Phase 2.

TradingView Lightweight Charts 5.2.0 is selected because it provides performant canvas candlesticks, crosshair behavior, time/price scales, native price lines, logical-range navigation, and responsive resizing. Phase 2 validated custom price-scale-aware filled zones through the public series primitive API. The TradingView attribution logo is disabled to meet the no-watermark product requirement; a visible TradingView link is retained in the chart legend to satisfy library attribution requirements. Alternatives such as Highcharts Stock or a custom chart implementation remain rejected unless a later requirement identifies a concrete incompatibility.

## ADR-010: Node.js local service instead of browser-only scheduling

Status: Accepted.

Browser tabs are not reliable schedulers: they sleep, close, lose notifications, and cannot safely own SQLite or provider secrets. The Node service owns scheduled runs and local persistence; the browser renders and requests manual refresh.

## ADR-011: Tauri versus Electron packaging

Status: Unresolved.

Tauri is preferred for a smaller native shell and native integrations, but Electron may be lower risk if a Node-process ecosystem or export tooling requires it. Resolve after the browser-first chart, SQLite, notification, and PNG-export proof points pass.

## ADR-012: H4 schedule and completed-candle authority

Status: Accepted.

The official timezone is `America/Toronto` and the primary timeframe is H4. Priority scheduled analyses run at 13:01 and 21:01 local time, one minute after expected H4 closes. The provider must still explicitly mark the latest H4 candle closed before BUY or SELL is possible. Open, unavailable, stale, or inconsistent candles remain WAIT or NO_TRADE; stale market data specifically results in NO_TRADE.

## ADR-013: Reward-to-risk, grade, and premium-card policy

Status: Accepted.

Minimum reward-to-risk is 2.0. Setup Score grades are `0-49 D`, `50-59 C`, `60-69 C+`, `70-79 B`, `80-89 A`, and `90-100 A+`. A premium setup card may appear at 70 or above for a WAIT action to show that a high-quality setup is forming. It does not authorize entry. The Patience Filter always overrides Setup Score.

## ADR-014: Required context and confirmation instruments

Status: Accepted.

Missing macro or event-risk data results in WAIT or NO_TRADE. US500 and US30 are primary cross-market confirmation instruments; Russell 2000 is complementary in the MVP. The market-data provider remains unresolved.

## ADR-015: Versioned Zod authority and explicit safety normalization

Status: Accepted and implemented in Phase 3.

The authoritative browser-first contracts live in `src/schemas/` at schema version `1.0.0`, with TypeScript types inferred from Zod. Incoming values pass through a version gate, deterministic normalizer, structural validation, and non-strategy safety enforcement before rendering. Unsupported versions are rejected; migration functions must be pure and explicitly registered. Normalization may canonicalize representation and default optional arrays, but it cannot invent prices, scores, indicators, or candle-completion facts.

Safety enforcement converts structurally valid but unsafe BUY/SELL input to WAIT-family or NO_TRADE states. It does not calculate indicators, classify a setup, select a strategy action from market evidence, or calculate Setup Score; those responsibilities remain in later phases.

## Unresolved decisions

- Select a licensed NAS100 and proxy-market data provider, including symbol mapping, licensing, rate limits, and historical access.
- Define thresholds for “acceptable location,” cross-market alignment, ATR distance, first-retest rules, event blocking, and data freshness age.
- Select macro and event-risk data sources for the first live release.
- Define outcome labels and methodology for historical setup evaluation/backtesting.
- Select Windows notification adapter and packaging technology after proof-of-concept evidence.
