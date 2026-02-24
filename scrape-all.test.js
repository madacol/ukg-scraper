import { test } from "node:test";
import assert from "node:assert";
import { filterTimecardEntries } from "./scrape-all.js";

// --- filterTimecardEntries ---
// Timecard dates are in DD/MM format (European)

test("filterTimecardEntries: keeps entries within last 14 days", () => {
  const entries = [
    { date: "20/02", day: "Fri" },
    { date: "15/02", day: "Sun" },
    { date: "11/02", day: "Wed" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 3);
});

test("filterTimecardEntries: excludes entries older than 14 days", () => {
  const entries = [
    { date: "20/02", day: "Fri" },
    { date: "09/02", day: "Mon" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].date, "20/02");
});

test("filterTimecardEntries: includes entry exactly 14 days ago", () => {
  const entries = [
    { date: "10/02", day: "Tue" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 1);
});

test("filterTimecardEntries: excludes entries after reference date", () => {
  const entries = [
    { date: "25/02", day: "Wed" },
    { date: "24/02", day: "Tue" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].date, "24/02");
});

test("filterTimecardEntries: handles month boundary", () => {
  const entries = [
    { date: "01/02", day: "Sun" },
    { date: "25/01", day: "Sun" },
    { date: "17/01", day: "Sat" },
  ];
  // 01 Feb - 14 days = 18 Jan, so 17/01 is excluded
  const result = filterTimecardEntries(entries, "2026-02-01");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].date, "25/01");
  assert.strictEqual(result[1].date, "01/02");
});

test("filterTimecardEntries: handles year boundary", () => {
  const entries = [
    { date: "05/01", day: "Mon" },
    { date: "28/12", day: "Sun" },
    { date: "20/12", day: "Sat" },
  ];
  // 05 Jan - 14 days = 22 Dec (prev year), so 20/12 is excluded
  const result = filterTimecardEntries(entries, "2026-01-05");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].date, "28/12");
  assert.strictEqual(result[1].date, "05/01");
});

test("filterTimecardEntries: empty entries returns empty", () => {
  const result = filterTimecardEntries([], "2026-02-24");
  assert.deepStrictEqual(result, []);
});

test("filterTimecardEntries: deduplicates by date keeping last occurrence", () => {
  const entries = [
    { date: "20/02", day: "Fri", clockIn1: "8:00" },
    { date: "20/02", day: "Fri", clockIn1: "9:00" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].clockIn1, "9:00");
});

test("filterTimecardEntries: returns entries sorted by date ascending", () => {
  const entries = [
    { date: "20/02", day: "Fri" },
    { date: "15/02", day: "Sun" },
    { date: "18/02", day: "Wed" },
  ];
  const result = filterTimecardEntries(entries, "2026-02-24");
  assert.strictEqual(result[0].date, "15/02");
  assert.strictEqual(result[1].date, "18/02");
  assert.strictEqual(result[2].date, "20/02");
});
