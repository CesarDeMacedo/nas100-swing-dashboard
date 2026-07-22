# UI Architecture

## Visual direction

The approved template is a layout and treatment reference, not an asset. Its visual hierarchy is: product identity at upper left, dominant action banner across the top center, compact score/regime metadata at upper right, a large chart on the left, evidence and instruction cards in a right sidebar, and a metrics strip along the bottom. The application recreates this hierarchy with React components and structured data.

The OANDA reference informs chart behavior only: black chart field, true up/down candlesticks, clear price and time axes, discrete horizontal levels, and readable current-price treatment. It does not imply copying broker controls, icons, branding, or mobile navigation.

## Component map

| Component                   | Responsibility                                         | Required props                                              | Data ownership                          |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------- |
| `AppShell`                  | screen frame, routing region, responsive layout        | `children`, `activeScreen`, `serviceState`                  | owns view layout only                   |
| `DashboardHeader`           | product title, instrument, timeframe, top metadata     | `instrument`, `displayName`, `timeframe`, `freshness`       | receives formatted report fields        |
| `PrimaryActionBanner`       | dominant action, grade/score emphasis, status          | `action`, `status`, `setupScore`, `blockers`                | maps action enum to presentation only   |
| `SetupSummary`              | regime, bias, score, grade, confidence summary         | `marketMap`, `setupScore`, `status`, `confidence`           | presentational                          |
| `CandlestickChartPanel`     | chart composition and lifecycle                        | `candles`, `zones`, `decision`, `freshness`                 | owns chart instance, not data decisions |
| `ChartHeader`               | instrument, timeframe, OHLC/current price, provider    | `instrument`, `timeframe`, `latestCandle`, `providerStatus` | formatted values only                   |
| `PriceZoneOverlay`          | maps support, resistance, entry and invalidation zones | `zones`, `priceScale`                                       | receives zone view models               |
| `ScenarioProjectionOverlay` | visualizes validated optional paths                    | `scenarios`, `action`                                       | no forecast generation                  |
| `ChartDecisionOverlay`      | shows report-derived action, trigger, and blockers     | `action`, `entryTrigger`, `whatToDoNext`                    | no strategy calculation                 |
| `InstructionCard`           | shared titled icon/list evidence card                  | `title`, `tone`, `items`, `icon`                            | generic reusable component              |
| `AnalysisSidebar`           | vertical evidence-card layout                          | `children` or card view models                              | layout only                             |
| `WhyNoEntryCard`            | blockers and no-entry rationale                        | `action`, `items`, `reasonCodes`                            | report-derived content                  |
| `NextActionCard`            | next step list and cancellation guidance               | `items`, `action`                                           | report-derived content                  |
| `SetupScoreCard`            | category/total/grade breakdown                         | `setupScore`, `action`                                      | report-derived content                  |
| `MarketContextCard`         | cross-market and event evidence                        | `crossMarket`, `eventRisks`, `drivers`                      | report-derived content                  |
| `MetricsFooter`             | fixed summary metrics strip                            | `metrics`, `freshness`, `completedCandleAt`                 | report-derived view model               |
| `DataFreshnessBadge`        | freshness/provider state                               | `freshness`, `providerStatus`, `completedCandleAt`          | maps health enum only                   |
| `ErrorState`                | invalid/unavailable service/report response            | `title`, `detail`, `retry?`                                 | boundary error ownership                |
| `LoadingState`              | stable loading surface                                 | `label`                                                     | UI-only state                           |

`DashboardPage` is the composition root. A `useCurrentAnalysis` data hook validates the API/fixture response at the boundary, builds display-only view models, and provides them to the page. Zustand may retain the selected report id, screen, and display options, but the report itself remains server/fixture data rather than mutable client strategy state.

## Layout and responsive behavior

At desktop widths, preserve the reference's 16:9 composition inside a responsive container: header row, a two-column main area with the chart taking roughly 70-73% and sidebar 27-30%, then a metrics footer. The chart panel has a stable minimum height and uses `ResizeObserver` to resize the chart without layout shifts. The banner remains prominent but may wrap action text before truncating.

At medium widths, keep the action header readable, reduce side-card density, and retain chart precedence. At narrow widths, stack header metadata, banner, chart, sidebar cards, then footer; no text overlaps or becomes inaccessible. The reference is desktop-first rather than a mandate for a fixed non-responsive canvas.

## Visual tokens

Define semantic CSS variables/Tailwind tokens, not component-local hex values:

```text
surface.app: near-black navy
surface.chart: deep blue-black
surface.panel: dark navy with restrained border
text.primary: high-contrast cool white
text.secondary: muted cool gray
grid: low-contrast blue-gray
positive: green for support / bullish confirmation
negative: red for resistance / invalidation / bearish risk
warning: orange for WAIT states and attention
info: cyan-blue for context and freshness
neutral: gray for unavailable/neutral
```

Typography is compact for metadata, dense but readable for cards, and large only for the product title and primary action. Borders and modest shadows define panels; avoid decorative gradients, oversized rounded cards, and the use of either reference image as a background.

## Action-state color mapping

| Action                   | Primary color | Treatment                                                    |
| ------------------------ | ------------- | ------------------------------------------------------------ |
| `BUY`                    | green         | positive action, still displays confirmation and risk levels |
| `SELL`                   | red           | negative action, still displays confirmation and risk levels |
| `WAIT`                   | orange        | caution, no executable implication                           |
| `NO_TRADE`               | red/neutral   | blocked action with explicit reason                          |
| `WAIT_FOR_PULLBACK`      | orange        | pullback instruction and preferred zone emphasis             |
| `WAIT_FOR_NEXT_4H_CLOSE` | orange        | completed-candle protection and timestamp emphasis           |

Color is supplementary: every state also uses visible action text, status text, and reason content.

A score of 70 or above may present the premium `SetupScoreCard` treatment while the action remains WAIT. The score treatment communicates setup quality only; the banner and decision overlay continue to show the Patience Filter result and never imply entry authorization.

## Chart replacement strategy

Phase 1 used a correctly sized chart panel placeholder only. Phase 2 now creates `CandlestickChartPanel` around a Lightweight Charts 5.2.0 instance and maps a validated dedicated mock candle collection to a candlestick series. The panel adds grid/time/price scale options, crosshair behavior, an initial recent logical range, and report-derived zones and markers. It does not draw or crop the template image.

`PriceZoneOverlay` converts `PriceZone` values into library primitives or positioned overlay elements with a single adapter. `ChartDecisionOverlay` shows action guidance and confirmed trigger labels from report fields. `ScenarioProjectionOverlay` is optional and must be styled as a conditional scenario, not a price prediction; it is absent when the report contains no validated scenario data. The OANDA image informs density and financial-chart readability, not a visual copy target.

The implemented `PriceZoneLayer` is a Lightweight Charts series primitive rather than an absolutely positioned HTML approximation. It converts zone prices through the active candlestick series price scale on each draw, contributes every overlay price to autoscaling, and draws restrained filled bands with readable labels. Current price, invalidation, stop, targets, and a differing completed-candle close use native chart price lines. If analysis current price and final mock close differ, both remain unchanged and receive distinct labels.

`FinancialChart` owns library creation, series setup, visible-range initialization, `ResizeObserver`, primitive attachment, and teardown. `ChartLegend` and the screen-reader summary provide non-canvas OHLC context. `ChartStatusOverlay` communicates completed versus open H4 state without deciding the action. Invalid candle data renders a chart-specific error while the rest of the validated dashboard remains visible.

## Avoiding strategy coupling

UI props use enums, normalized values, and precomputed strings from the validated report. Components never inspect EMA ordering, calculate R:R, determine staleness, infer a zone, or choose an action. A mapping layer can turn a `SetupScoreBreakdown` into card rows and `EventRisk` into badges, but it cannot change their values. This makes fixture-driven visual tests possible and keeps strategy changes isolated to domain packages.

For failure conditions, the page receives a typed state rather than a partial report. `ErrorState` replaces actionable panels when validation fails. `DataFreshnessBadge` and `PrimaryActionBanner` make stale, open-candle, and NO_TRADE conditions prominent even if earlier cached content exists.
