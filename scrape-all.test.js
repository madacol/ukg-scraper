import { test } from "node:test";
import assert from "node:assert";
import { filterTimecardEntries } from "./scrape-all.js";

// --- filterTimecardEntries ---

test("filterTimecardEntries: keeps entries within last 14 days", () => {
  const entries = [
    { date: "02/20", day: "Fri" },
    { date: "02/15", day: "Sun" },
    { date: "02/11", day: "Wed" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 3);
});

test("filterTimecardEntries: excludes entries older than 14 days", () => {
  const entries = [
    { date: "02/20", day: "Fri" },
    { date: "02/09", day: "Mon" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].date, "02/20");
});

test("filterTimecardEntries: includes entry exactly 14 days ago", () => {
  const entries = [
    { date: "02/10", day: "Tue" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 1);
});

test("filterTimecardEntries: excludes entries after reference date", () => {
  const entries = [
    { date: "02/25", day: "Wed" },
    { date: "02/24", day: "Tue" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].date, "02/24");
});

test("filterTimecardEntries: handles month boundary", () => {
  const entries = [
    { date: "02/01", day: "Sun" },
    { date: "01/25", day: "Sun" },
    { date: "01/17", day: "Sat" },
  ];
  // 02/01 - 14 days = 01/18, so 01/17 is excluded
  const result = filterTimecardEntries(entries, "2026-02-01");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].date, "01/25");
  assert.strictEqual(result[1].date, "02/01");
});

test("filterTimecardEntries: handles year boundary", () => {
  const entries = [
    { date: "01/05", day: "Mon" },
    { date: "12/28", day: "Sun" },
    { date: "12/20", day: "Sat" },
  ];
  // 01/05 - 14 days = 12/22 (prev year), so 12/20 is excluded
  const result = filterTimecardEntries(entries, "2026-01-05");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].date, "12/28");
  assert.strictEqual(result[1].date, "01/05");
});

test("filterTimecardEntries: empty entries returns empty", () => {
  const result = filterTimecardEntries([], "2026-02-24");
  assert.deepStrictEqual(result, []);
});

test("filterTimecardEntries: deduplicates by date keeping last occurrence", () => {
  const entries = [
    { date: "02/20", day: "Fri", clockIn1: "8:00" },
    { date: "02/20", day: "Fri", clockIn1: "9:00" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].clockIn1, "9:00");
});

test("filterTimecardEntries: returns entries sorted by date ascending", () => {
  const entries = [
    { date: "02/20", day: "Fri" },
    { date: "02/15", day: "Sun" },
    { date: "02/18", day: "Wed" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result[0].date, "02/15");
  assert.strictEqual(result[1].date, "02/18");
  assert.strictEqual(result[2].date, "02/20");
});
