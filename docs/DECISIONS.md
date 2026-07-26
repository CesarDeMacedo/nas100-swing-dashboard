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

Status: Accepted; schedule expanded from 2 to 6 daily slots.

The official timezone is `America/Toronto` and the primary timeframe is H4. Scheduled analyses run six times daily, once per H4 close, at 01:01, 05:01, 09:01, 13:01, 17:01, and 21:01 local time, each one minute after that slot's expected H4 close (originally only the 13:01/21:01 slots ran; the other four were added to gather real data on when entries actually occur, ahead of backtesting parameter changes — see ADR-017). All six times are computed by `Intl.DateTimeFormat` against `America/Toronto`, not a fixed UTC offset, so they resolve correctly across both annual DST transitions (`src/service/scheduler/torontoSchedule.ts`, `torontoSchedule.test.ts`). The provider must still explicitly mark the latest H4 candle closed before BUY or SELL is possible. Open, unavailable, stale, or inconsistent candles remain WAIT or NO_TRADE; stale market data specifically results in NO_TRADE.

## ADR-013: Reward-to-risk, grade, and premium-card policy

Status: Accepted; reward-to-risk is now a configurable floor rather than a single fixed value.

Minimum reward-to-risk is 2.0 for the default pipeline. Since ADR-017, a versioned strategy config may raise this minimum but a strategy's `minRewardRisk` can never be set below 2.0 — enforced by shared Zod validation server-side (`src/schemas/strategyConfig.ts`), not only in the UI. Setup Score grades are `0-49 D`, `50-59 C`, `60-69 C+`, `70-79 B`, `80-89 A`, and `90-100 A+`. A premium setup card may appear at 70 or above (or above a strategy's configured `premiumScoreThreshold`) for a WAIT action to show that a high-quality setup is forming. It does not authorize entry. The Patience Filter always overrides Setup Score.

## ADR-014: Required context and confirmation instruments

Status: Accepted; cross-market provider resolved, event-risk provider still a validation spike.

Missing macro or event-risk data results in WAIT or NO_TRADE. US500 and US30 are primary cross-market confirmation instruments; Russell 2000 is complementary in the MVP. The cross-market provider question is resolved: `SPX500_USD`, `US30_USD`, and `US2000_USD` are confirmed available on the same OANDA v20 account already used for NAS100 (verified via a one-off account-instrument check), so no separate provider was needed — see `src/service/oandaRun.ts`'s `fetchCrossMarketH4`. The event-risk provider remains unresolved for production; an unofficial Forex Factory feed (`src/service/forexFactoryEventRisk.ts`) is wired as a validation spike only, to observe whether real event-risk data changes computed decisions before committing to a paid/stable source.

## ADR-016: OANDA manual/scheduled pipeline entry authorization stays clamped pending event-risk resolution

Status: Accepted, temporary — revisit once ADR-014's event-risk provider question is resolved.

`enforceAnalysisSafety` (`src/domain/safety.ts`, ADR-015) only runs on the browser/chart-adapter side (`src/components/chart/chartAdapter.ts`); the OANDA server pipeline (`src/service/oandaRun.ts`) never calls it. The sole entry-authorization gate for that pipeline is `safetyConstrainedState`, which unconditionally forces `action` to `WAIT`-family, `isActionable: false`, and clears entry/stop/target fields regardless of what the underlying deterministic pipeline (`buildDashboardState`) computes. This was originally redundant — with cross-market and event-risk both hardcoded `UNAVAILABLE`/`unknown`, the Patience Filter alone already prevented `allowed` status — but ceased to be redundant once A1 made cross-market confirmation real. The clamp is intentionally kept in place regardless: as long as event-risk is a validation spike (ADR-014) rather than a resolved production input, no realistic combination of inputs may authorize BUY/SELL from this pipeline. `src/service/oandaRun.test.ts` ("proves the safety clamp actually holds something back") constructs a fully realistic scenario where the underlying pipeline genuinely computes `BUY`, and asserts the clamp still forces `WAIT` — verified by temporarily bypassing the clamp and confirming that exact test fails.

## ADR-015: Versioned Zod authority and explicit safety normalization

Status: Accepted and implemented in Phase 3.

The authoritative browser-first contracts live in `src/schemas/` at schema version `1.0.0`, with TypeScript types inferred from Zod. Incoming values pass through a version gate, deterministic normalizer, structural validation, and non-strategy safety enforcement before rendering. Unsupported versions are rejected; migration functions must be pure and explicitly registered. Normalization may canonicalize representation and default optional arrays, but it cannot invent prices, scores, indicators, or candle-completion facts.

Safety enforcement converts structurally valid but unsafe BUY/SELL input to WAIT-family or NO_TRADE states. It does not calculate indicators, classify a setup, select a strategy action from market evidence, or calculate Setup Score; those responsibilities remain in later phases.

## ADR-017: Configurable strategy parameters and an isolated backtest harness

Status: Accepted and implemented.

**Configurable strategy parameters.** The pipeline's previously hardcoded constants (minimum R:R, ATR geometry buffers, which cross-market instruments are "primary" vs. supplementary, Setup Score category weights, the premium-score threshold) are now parameters injected into `calculateTradePlan`, `evaluatePatienceFilter`, `decideStrategy`, `calculateSetupScore`, `selectOfficialSetupScore`, and `buildDashboardState` (`src/domain/strategyParameters.ts`), each an *optional*, *additive* argument defaulting to `DEFAULT_STRATEGY_PARAMETERS` — today's exact hardcoded values, verified byte-identical to the pre-change pipeline by a dedicated equality test (`src/application/buildDashboardState.test.ts`). No existing call site (manual runs, the scheduler) passes a strategy yet, so live/scheduled behavior is unchanged; only the backtest harness resolves and passes an explicit strategy today.

A "strategy" is a named, versioned parameter set persisted in a new `strategy_configs` table (`src/persistence/analysisRepository.ts`, `src/schemas/strategyConfig.ts`): immutable once published (`draft -> active -> archived`; editing an `active` version creates a new `draft` version instead), so a historical run's parameters remain reconstructable even after the strategy is later changed. `minRewardRisk >= 2.0` and `setupScoreWeights` summing to exactly 100 are both enforced by a single shared Zod schema at the one write path (`AnalysisRepository.saveStrategyConfig`), not just in the UI form — a SQLite `CHECK` on the normalized `min_reward_risk` column exists as defense-in-depth for the R:R floor specifically (no equivalent CHECK is possible for the weights sum, since those values live only inside the JSON blob).

**Backtest harness (`scripts/backtest/`).** A CLI tool, deliberately isolated from the production service (own SQLite file, own `tsconfig.scripts.json`), that replays the *unmodified* production pipeline (`buildOandaMultiTimeframeInputs` + `buildDashboardState`, bypassing only the temporary ADR-016 safety clamp) against OANDA historical candles. Zero lookahead is a structural guarantee, not a convention: every simulated decision point is built by cutting each candle series (NAS100 H4/Daily, cross-market H4) at the same instant by timestamp (`cutSeriesAt`, `scripts/backtest/replayWindow.ts`), and a dedicated test proves appending future candles and re-cutting at the same instant reproduces byte-identical pipeline output. Each hypothetical signal is walked forward through a fill/outcome state machine (`scripts/backtest/signalOutcome.ts`) with an explicit, conservative same-candle tie-break rule (invalidation beats fill; stop beats target) chosen specifically so OHLC ambiguity can never silently inflate the reported win rate. Event-risk history is out of scope for this first version — the replay always passes `eventRisk: []` (the pipeline's own "feed checked, nothing found" case, which resolves to `clear`), not `undefined` (which resolves to `unknown` and would block every signal via the Patience Filter). Triggering a backtest is CLI-only in v1 (`tsx scripts/backtest/runBacktest.ts`); the web UI's "Run backtest" control only builds the command to copy, deliberately avoiding child-process spawning inside the production service.

## Unresolved decisions

- NAS100 and cross-market (US500, US30, Russell 2000) are both resolved: all four instruments are available on the same OANDA v20 account, no separate provider or licensing needed (ADR-014).
- Location and entry-trigger ATR thresholds are resolved (Phase 6B: 0.35 ATR zone/EMA tolerance, 0.05 ATR trigger, 0.25 ATR stop buffer; Phase 5B: 0.10 ATR breakout buffer). Still open: cross-market alignment rules, first-retest rules, event-blocking rules, and data-freshness age thresholds — event-blocking specifically has only a provisional placeholder (High-impact USD event within +/-60min, see `src/service/forexFactoryEventRisk.ts`), not a resolved rule.
- Select a production-grade macro/event-risk data source for the first live release. A validation spike (unofficial Forex Factory feed) is wired for observation only — see ADR-014, ADR-016. Entry authorization from the OANDA pipeline remains hard-blocked regardless of what this spike returns.
- Outcome labels and methodology for historical setup evaluation/backtesting are resolved for the win/loss/cancelled/unresolved state machine and expectancy formula (ADR-017). Still open: replaying event-risk history (the harness currently assumes always-clear) and wiring a resolved `active` strategy into the live/scheduled pipeline (today only the backtest harness passes an explicit strategy).
- Select Windows packaging technology after proof-of-concept evidence (see ADR-011, still unresolved). The notification *adapter* question is resolved separately: `node-notifier` is in production use for scheduler outcomes (see CHANGELOG), independent of packaging, since it runs from the existing Node service rather than a packaged native shell.

# Current product boundary

The implementation remains analysis-only and local-first. OANDA is read-only with server-side credentials; there is no browser-to-OANDA connection or trade execution. H4 and Daily inputs are separate, completed-candle safety is authoritative, saved OANDA reports are immutable, and Chart Preview is on-demand only. The fixture scheduler remains the default; OANDA scheduling is opt-in and now evaluates all six daily H4-close slots (ADR-012). Cross-market confirmation is live (same OANDA account); event-risk is a validation spike only (unofficial feed, not a production commitment); live OANDA observation remains experimental pending broader real-world use. Entry authorization from the OANDA pipeline remains hard-blocked pending event-risk resolution (ADR-016), independent of what any individual input computes. Strategy parameters are configurable and versioned (ADR-017), but no live/scheduled run selects a non-default strategy yet — only the isolated backtest harness does, and it never executes trades or touches the OANDA pipeline's entry-authorization clamp.
