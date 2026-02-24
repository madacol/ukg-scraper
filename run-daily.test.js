import { test } from "node:test";
import assert from "node:assert";
import {
  formatShift, detectScheduleChanges, detectTimecardDiscrepancy,
  detectTimecardChanges, parseTime, formatAlert,
  calculateDailyTotal, formatClockPairs, detectTotalMismatch,
} from "./run-daily.js";

// --- parseTime ---

test("parseTime: normal times", () => {
  assert.strictEqual(parseTime("9:00"), 540);
  assert.strictEqual(parseTime("13:30"), 810);
  assert.strictEqual(parseTime("0:00"), 0);
  assert.strictEqual(parseTime("23:59"), 1439);
});

test("parseTime: null/invalid returns null", () => {
  assert.strictEqual(parseTime(null), null);
  assert.strictEqual(parseTime(undefined), null);
  assert.strictEqual(parseTime(""), null);
  assert.strictEqual(parseTime("abc"), null);
  assert.strictEqual(parseTime("12:60:00"), null);
});

// --- formatShift ---

test("formatShift: normal shift", () => {
  assert.strictEqual(formatShift({ start: "9:00", end: "17:00", off: false }), "9:00–17:00");
});

test("formatShift: day off with note", () => {
  assert.strictEqual(formatShift({ start: null, end: null, off: true, note: "ROI Day Off Request TOR (Full)" }), "ROI Day Off Request TOR (Full)");
});

test("formatShift: day off without note", () => {
  assert.strictEqual(formatShift({ start: null, end: null, off: true, note: null }), "Day Off");
});

test("formatShift: no time, no off, but has note (raw details)", () => {
  assert.strictEqual(formatShift({ start: null, end: null, off: false, note: "Some unknown text" }), "Some unknown text");
});

test("formatShift: no time, no off, no note", () => {
  assert.strictEqual(formatShift({ start: null, end: null, off: false, note: null }), "No details");
});

// --- calculateDailyTotal ---

test("calculateDailyTotal: single clock pair", () => {
  assert.strictEqual(calculateDailyTotal({ clockIn1: "9:00", clockOut1: "17:00" }), "8:00");
});

test("calculateDailyTotal: two clock pairs", () => {
  const entry = { clockIn1: "13:56", clockOut1: "16:36", clockIn2: "16:51", clockOut2: "19:26" };
  assert.strictEqual(calculateDailyTotal(entry), "5:15");
});

test("calculateDailyTotal: no complete pairs returns null", () => {
  assert.strictEqual(calculateDailyTotal({ clockIn1: "9:00", clockOut1: null }), null);
  assert.strictEqual(calculateDailyTotal({}), null);
});

test("calculateDailyTotal: short shift", () => {
  assert.strictEqual(calculateDailyTotal({ clockIn1: "14:00", clockOut1: "14:30" }), "0:30");
});

// --- formatClockPairs ---

test("formatClockPairs: single pair", () => {
  assert.strictEqual(formatClockPairs({ clockIn1: "9:00", clockOut1: "17:00" }), "9:00 - 17:00");
});

test("formatClockPairs: two pairs", () => {
  const entry = { clockIn1: "13:56", clockOut1: "16:36", clockIn2: "16:51", clockOut2: "19:26" };
  assert.strictEqual(formatClockPairs(entry), "13:56 - 16:36, 16:51 - 19:26");
});

test("formatClockPairs: no pairs returns null", () => {
  assert.strictEqual(formatClockPairs({}), null);
  assert.strictEqual(formatClockPairs({ clockIn1: null, clockOut1: null }), null);
});

test("formatClockPairs: incomplete pair shows question mark", () => {
  assert.strictEqual(formatClockPairs({ clockIn1: "9:00", clockOut1: null }), "9:00 - ?");
});

// --- detectScheduleChanges ---

test("detectScheduleChanges: null old data returns null (first run)", () => {
  const newData = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  assert.strictEqual(detectScheduleChanges(null, newData), null);
});

test("detectScheduleChanges: no changes returns null", () => {
  const data = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  assert.strictEqual(detectScheduleChanges(data, data), null);
});

test("detectScheduleChanges: time change detected", () => {
  const oldData = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const newData = { shifts: [{ date: "2026-02-20", day: "Fri", start: "10:00", end: "18:00", off: false }] };
  const result = detectScheduleChanges(oldData, newData);
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("Fri 20 Feb"));
  assert.ok(result[0].includes("Was:"));
  assert.ok(result[0].includes("9:00–17:00"));
  assert.ok(result[0].includes("Now:"));
  assert.ok(result[0].includes("10:00–18:00"));
});

test("detectScheduleChanges: shift becomes day off", () => {
  const oldData = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const newData = { shifts: [{ date: "2026-02-20", day: "Fri", start: null, end: null, off: true, note: "Day Off" }] };
  const result = detectScheduleChanges(oldData, newData);
  assert.ok(result);
  assert.ok(result[0].includes("Fri 20 Feb"));
  assert.ok(result[0].includes("Was:"));
  assert.ok(result[0].includes("Now:"));
  assert.ok(result[0].includes("Day Off"));
});

test("detectScheduleChanges: new day appears", () => {
  const oldData = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const newData = {
    shifts: [
      { date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false },
      { date: "2026-02-21", day: "Sat", start: "8:00", end: "16:00", off: false },
    ],
  };
  const result = detectScheduleChanges(oldData, newData);
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("Sat 21 Feb"));
  assert.ok(result[0].includes("New"));
  assert.ok(result[0].includes("8:00–16:00"));
});

// --- detectTimecardDiscrepancy ---

test("detectTimecardDiscrepancy: day off returns null", () => {
  const schedule = { shifts: [{ date: "2026-02-20", day: "Fri", start: null, end: null, off: true }] };
  const timecard = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  assert.strictEqual(detectTimecardDiscrepancy(schedule, timecard, "2026-02-20"), null);
});

test("detectTimecardDiscrepancy: within threshold returns null", () => {
  const schedule = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const timecard = { entries: [{ date: "20/02", day: "Fri", clockIn1: "8:50", clockOut1: "17:10" }] };
  assert.strictEqual(detectTimecardDiscrepancy(schedule, timecard, "2026-02-20"), null);
});

test("detectTimecardDiscrepancy: >50 min difference returns issues", () => {
  const schedule = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const timecard = { entries: [{ date: "20/02", day: "Fri", clockIn1: "7:00", clockOut1: "19:00" }] };
  const result = detectTimecardDiscrepancy(schedule, timecard, "2026-02-20");
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("Fri 20 Feb"));
  assert.ok(result[0].includes("Clock In"));
  assert.ok(result[0].includes("7:00"));
  assert.ok(result[0].includes("scheduled 9:00"));
  assert.ok(result[0].includes("Clock Out"));
  assert.ok(result[0].includes("19:00"));
  assert.ok(result[0].includes("scheduled 17:00"));
});

test("detectTimecardDiscrepancy: only clock-in mismatch", () => {
  const schedule = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const timecard = { entries: [{ date: "20/02", day: "Fri", clockIn1: "7:00", clockOut1: null }] };
  const result = detectTimecardDiscrepancy(schedule, timecard, "2026-02-20");
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("Clock In"));
  assert.ok(!result[0].includes("Clock Out"));
});

// --- detectTimecardChanges ---

test("detectTimecardChanges: null old data returns null", () => {
  const newData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  assert.strictEqual(detectTimecardChanges(null, newData), null);
});

test("detectTimecardChanges: no changes returns null", () => {
  const data = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  assert.strictEqual(detectTimecardChanges(data, data), null);
});

test("detectTimecardChanges: changed clocks shown as Was/Now pairs", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00", dailyTotal: "8:00" }] };
  const newData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "8:45", clockOut1: "17:30", dailyTotal: "8:45" }] };
  const result = detectTimecardChanges(oldData, newData);
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("Fri 20 Feb"));
  assert.ok(result[0].includes("Was:"));
  assert.ok(result[0].includes("9:00 - 17:00"));
  assert.ok(result[0].includes("Now:"));
  assert.ok(result[0].includes("8:45 - 17:30"));
  assert.ok(result[0].includes("Daily Total"));
  assert.ok(result[0].includes("8:00 → 8:45"));
  assert.ok(!result[0].includes("clockIn1"));
  assert.ok(!result[0].includes("Shift Total"));
});

test("detectTimecardChanges: new entry shows clock pairs and daily total", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "21/02", day: "Sat", clockIn1: "8:00", clockOut1: "16:00", dailyTotal: "8:00" },
    ],
  };
  const result = detectTimecardChanges(oldData, newData);
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("Sat 21 Feb"));
  assert.ok(result[0].includes("8:00 - 16:00"));
  assert.ok(result[0].includes("Daily Total: 8:00"));
  assert.ok(!result[0].includes("Clock In:"));
  assert.ok(!result[0].includes("Shift Total"));
});

test("detectTimecardChanges: new entry with no data is skipped", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "21/02", day: "Sat", clockIn1: null, clockOut1: null, dailyTotal: null },
    ],
  };
  const result = detectTimecardChanges(oldData, newData);
  assert.strictEqual(result, null);
});

test("detectTimecardChanges: pay code change shown alongside clock change", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00", dailyTotal: "8:00", payCode: null }] };
  const newData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "8:00", clockOut1: "18:00", dailyTotal: "10:00", payCode: "Overtime" }] };
  const result = detectTimecardChanges(oldData, newData);
  assert.ok(result);
  assert.ok(result[0].includes("Was:"));
  assert.ok(result[0].includes("Now:"));
  assert.ok(result[0].includes("Pay Code"));
  assert.ok(result[0].includes("Daily Total"));
  assert.ok(!result[0].includes("Shift Total"));
});

// --- detectTotalMismatch ---

test("detectTotalMismatch: matching totals returns null", () => {
  const data = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00", dailyTotal: "8:00" }] };
  assert.strictEqual(detectTotalMismatch(data), null);
});

test("detectTotalMismatch: mismatched totals returns alert", () => {
  const data = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00", dailyTotal: "7:30" }] };
  const result = detectTotalMismatch(data);
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("Fri 20 Feb"));
  assert.ok(result[0].includes("8:00"));
  assert.ok(result[0].includes("7:30"));
});

test("detectTotalMismatch: skips entries without complete clock pairs", () => {
  const data = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: null, dailyTotal: "8:00" }] };
  assert.strictEqual(detectTotalMismatch(data), null);
});

test("detectTotalMismatch: null data returns null", () => {
  assert.strictEqual(detectTotalMismatch(null), null);
});

test("detectTotalMismatch: skips entries without scraped total", () => {
  const data = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00", dailyTotal: null }] };
  assert.strictEqual(detectTotalMismatch(data), null);
});

// --- formatAlert ---

test("formatAlert: formats section with title and items", () => {
  const result = formatAlert("SCHEDULE CHANGES", ["Fri 20 Feb — Changed\n  Was: 9:00–17:00\n  Now: 10:00–18:00"]);
  assert.ok(result.startsWith("SCHEDULE CHANGES\n"));
  assert.ok(result.includes("----------------"));
  assert.ok(result.includes("Fri 20 Feb"));
});

test("formatAlert: separates multiple items with blank lines", () => {
  const items = [
    "Fri 20 Feb — Changed\n  Was: 9:00–17:00\n  Now: 10:00–18:00",
    "Sat 21 Feb — New\n  8:00–16:00",
  ];
  const result = formatAlert("SCHEDULE CHANGES", items);
  assert.ok(result.includes("\n\n"));
});
