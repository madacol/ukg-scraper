import { test } from "node:test";
import assert from "node:assert";
import { formatShift, detectScheduleChanges, detectTimecardDiscrepancy, detectTimecardChanges, parseTime } from "./run-daily.js";

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

test("formatShift: regular shift shows times", () => {
  assert.strictEqual(formatShift({ start: "9:00", end: "17:00", off: false }), "9:00–17:00");
});

test("formatShift: day off shows note", () => {
  assert.strictEqual(formatShift({ start: null, end: null, off: true, note: "Day Off" }), "Day Off");
});

test("formatShift: TOR entry shows note", () => {
  assert.strictEqual(formatShift({ start: null, end: null, off: true, note: "ROI PT Staff TOR (Full)" }), "ROI PT Staff TOR (Full)");
});

test("formatShift: no times and not off shows dash", () => {
  assert.strictEqual(formatShift({ start: null, end: null, off: false }), "—");
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
  assert.ok(result[0].includes("CHANGED"));
  assert.ok(result[0].includes("9:00–17:00"));
  assert.ok(result[0].includes("10:00–18:00"));
});

test("detectScheduleChanges: shift becomes day off", () => {
  const oldData = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const newData = { shifts: [{ date: "2026-02-20", day: "Fri", start: null, end: null, off: true, note: "Day Off" }] };
  const result = detectScheduleChanges(oldData, newData);
  assert.ok(result);
  assert.ok(result[0].includes("CHANGED"));
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
  assert.ok(result[0].includes("NEW"));
  assert.ok(result[0].includes("2026-02-21"));
});

test("detectScheduleChanges: TOR entry shows note not null-null", () => {
  const oldData = { shifts: [] };
  const newData = { shifts: [{ date: "2026-03-02", day: "Mon", start: null, end: null, off: true, note: "ROI PT Staff TOR (Full)" }] };
  const result = detectScheduleChanges(oldData, newData);
  assert.ok(result);
  assert.ok(result[0].includes("ROI PT Staff TOR (Full)"));
  assert.ok(!result[0].includes("null"));
});

// --- detectTimecardDiscrepancy ---

test("detectTimecardDiscrepancy: day off returns null", () => {
  const schedule = { shifts: [{ date: "2026-02-20", day: "Fri", start: null, end: null, off: true }] };
  const timecard = { entries: [{ date: "02/20", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  assert.strictEqual(detectTimecardDiscrepancy(schedule, timecard, "2026-02-20"), null);
});

test("detectTimecardDiscrepancy: within threshold returns null", () => {
  const schedule = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const timecard = { entries: [{ date: "02/20", day: "Fri", clockIn1: "8:50", clockOut1: "17:10" }] };
  assert.strictEqual(detectTimecardDiscrepancy(schedule, timecard, "2026-02-20"), null);
});

test("detectTimecardDiscrepancy: >50 min difference returns issues", () => {
  const schedule = { shifts: [{ date: "2026-02-20", day: "Fri", start: "9:00", end: "17:00", off: false }] };
  const timecard = { entries: [{ date: "02/20", day: "Fri", clockIn1: "7:00", clockOut1: "19:00" }] };
  const result = detectTimecardDiscrepancy(schedule, timecard, "2026-02-20");
  assert.ok(result);
  assert.strictEqual(result.length, 2);
  assert.ok(result[0].includes("Clock-in"));
  assert.ok(result[1].includes("Clock-out"));
});

// --- detectTimecardChanges ---

test("detectTimecardChanges: null old data returns null", () => {
  const newData = { entries: [{ date: "02/20", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  assert.strictEqual(detectTimecardChanges(null, newData), null);
});

test("detectTimecardChanges: no changes returns null", () => {
  const data = { entries: [{ date: "02/20", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  assert.strictEqual(detectTimecardChanges(data, data), null);
});

test("detectTimecardChanges: changed clock times detected", () => {
  const oldData = { entries: [{ date: "02/20", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = { entries: [{ date: "02/20", day: "Fri", clockIn1: "8:45", clockOut1: "17:30" }] };
  const result = detectTimecardChanges(oldData, newData);
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("CHANGED"));
  assert.ok(result[0].includes("clockIn1"));
});

test("detectTimecardChanges: new entry detected", () => {
  const oldData = { entries: [{ date: "02/20", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "02/20", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "02/21", day: "Sat", clockIn1: "8:00", clockOut1: "16:00" },
    ],
  };
  const result = detectTimecardChanges(oldData, newData);
  assert.ok(result);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].includes("NEW"));
  assert.ok(result[0].includes("02/21"));
});
