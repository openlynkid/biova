# ADR-0012: Daily analytics breakdown and a selectable range

- Status: Accepted
- Date: 2026-11-13

## Context

ADR-0010 gave the dashboard a summary: totals for the last 30 days. Two gaps
remained. The window was fixed at 30 days, so a creator could not look at a week
or a quarter, and the summary was a single number per metric, so a creator could
not see whether traffic was rising or falling or which day carried it. PRD 4.7
lists "more analytics breakdowns" as the follow-up, and Phase 4 lists "revenue
dashboard" and "conversion improvements".

A trend chart is also where double counting becomes visible. If the summary and
the chart are computed from two different windows, the bars will not add up to
the numbers above them, and a creator will reasonably conclude one of them is
wrong.

## Decision

### One window definition for the summary and the chart

`seriesWindow(range, now)` in `@biova/shared` returns the last N calendar days in
UTC, oldest first, ending on the current UTC day, plus the `since` timestamp at
midnight of the first day. The analytics service uses it for both `summary` and
`timeseries`, so the daily buckets always sum to the summary totals. This
replaced the summary's previous rolling N×24-hour window, which would have been a
slightly wider span than the chart beside it.

Buckets are calendar days, not 24-hour blocks ending at load time. A chart that
aligns to midnight is stable: two readers on the same UTC day see the same
buckets, and a bar labelled "13 Nov" means that day rather than a window that
drifts as the page is reloaded.

### Days are bucketed in SQL, gaps are filled in a pure function

Each event table is grouped by `to_char(created_at at time zone 'UTC',
'YYYY-MM-DD')` in the repository. `buildDailySeries` then merges the four sets of
rows (page views, link clicks, product views, paid orders) onto the day list from
`seriesWindow` and defaults any missing day to zero. The function is pure and
clock-free, so the gap-filling rule — "a day with no rows is a real zero, not a
missing entry" — is unit-tested without a database.

Paid revenue per day is a second injected function on `AnalyticsDeps`
(`paidRevenueByDay`), supplied by the orders domain through `createServices`, so
the analytics domain still imports no other domain.

### The range is a validated enum shared by the API and the UI

`7d`, `30d`, `90d` is the same `analyticsRangeSchema` the summary already
validated. The API exposes `GET /v1/analytics/timeseries?range=` and the web
server function `getAnalytics(range)` returns the summary and the days together,
so the range control re-reads both in one call and they can never describe two
periods. The dashboard loader still seeds the initial 30-day view, so the first
paint needs no extra request.

## Consequences

- The chart and the totals are consistent by construction; the API test asserts
  that the daily buckets sum to the summary for the same range.
- A new range is a value in the shared enum plus a UI button, not a query change.
- Read cost grows with the range: a 90-day chart is a 90-bucket scan of four
  tables. The `(creator_id, created_at)` indexes keep this bounded, and the
  scheduled rollup ADR-0010 anticipated remains the next step at high volume.
- Days are UTC, not the creator's local day. A creator in Jakarta sees a bar
  boundary at 07:00 local. A per-creator time zone is a schema change (store the
  zone, bucket by it) and is deferred until there is demand.
- The chart renders in CSS from the day array; there is no charting dependency,
  so the dashboard bundle does not grow with a plotting library.
