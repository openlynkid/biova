import { describe, expect, test } from "bun:test";
import { buildDailySeries, clickThroughRate, seriesWindow, utcDayKey } from "./analytics";

describe("clickThroughRate", () => {
  test("is clicks per view as a rounded percentage", () => {
    expect(clickThroughRate(1, 3)).toBe(33.3);
    expect(clickThroughRate(0, 10)).toBe(0);
  });

  test("is zero with no views rather than a division by zero", () => {
    expect(clickThroughRate(5, 0)).toBe(0);
  });
});

describe("seriesWindow", () => {
  const now = new Date("2026-11-13T22:10:00.000Z");

  test("ends on the current UTC day and counts the range inclusively", () => {
    const week = seriesWindow("7d", now);
    expect(week.days).toHaveLength(7);
    expect(week.days[0]).toBe("2026-11-07");
    expect(week.days[6]).toBe("2026-11-13");
    expect(week.since.toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  test("aligns to midnight UTC, not to the current instant", () => {
    // Late on the 13th still starts the window at midnight of the 7th, so two
    // readers on the same UTC day see the same buckets.
    expect(seriesWindow("7d", new Date("2026-11-13T00:05:00.000Z")).since.toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  test("crosses a month boundary", () => {
    expect(seriesWindow("30d", new Date("2026-11-05T12:00:00.000Z")).days[0]).toBe("2026-10-07");
  });
});

describe("utcDayKey", () => {
  test("is the UTC calendar day, not the local one", () => {
    expect(utcDayKey(new Date("2026-11-13T23:59:59.000Z"))).toBe("2026-11-13");
    expect(utcDayKey(new Date("2026-11-14T00:00:00.000Z"))).toBe("2026-11-14");
  });
});

describe("buildDailySeries", () => {
  const days = ["2026-11-11", "2026-11-12", "2026-11-13"];

  test("fills every day and defaults a day with no rows to zero", () => {
    const series = buildDailySeries({
      range: "7d",
      days,
      pageViews: [{ date: "2026-11-12", count: 4 }],
      linkClicks: [{ date: "2026-11-13", count: 2 }],
      productViews: [],
      orders: [{ date: "2026-11-12", count: 1, revenueIdr: 25000 }],
    });

    expect(series.range).toBe("7d");
    expect(series.days).toEqual([
      { date: "2026-11-11", pageViews: 0, linkClicks: 0, productViews: 0, orders: 0, revenueIdr: 0 },
      { date: "2026-11-12", pageViews: 4, linkClicks: 0, productViews: 0, orders: 1, revenueIdr: 25000 },
      { date: "2026-11-13", pageViews: 0, linkClicks: 2, productViews: 0, orders: 0, revenueIdr: 0 },
    ]);
  });

  test("keeps the caller's day order", () => {
    const series = buildDailySeries({ range: "7d", days, pageViews: [], linkClicks: [], productViews: [], orders: [] });
    expect(series.days.map((day) => day.date)).toEqual(days);
  });
});
