import { test } from "node:test";
import assert from "node:assert";
import {
  formatShift, detectScheduleChanges, detectTimecardDiscrepancy,
  detectTimecardChanges, parseTime, formatAlert,
  calculateDailyTotal, formatClockPairs, detectTotalMismatch,
  parseScraperResult, tailOutput,
} from "./run-daily.js";

// --- scraper process helpers ---

test("tailOutput: keeps only the last non-empty lines", () => {
  const text = "\nline 1\n\nline 2\nline 3\n";
  assert.strictEqual(tailOutput(text, 2), "line 2\nline 3");
});

test("parseScraperResult: returns structured errors from stdout on nonzero exit", () => {
  const result = parseScraperResult({
    status: 1,
    stdout: JSON.stringify({
      schedule: null,
      timecard: null,
      errors: ["Schedule scraper failed: timeout", "Timecard scraper failed: timeout"],
    }),
    stderr: "Logging in...\n[schedule] FAILED: timeout\n[timecard] FAILED: timeout\n",
  });

  assert.deepStrictEqual(result, {
    schedule: null,
    timecard: null,
    errors: ["Schedule scraper failed: timeout", "Timecard scraper failed: timeout"],
  });
});

test("parseScraperResult: throws stderr details when stdout is not structured JSON", () => {
  assert.throws(
    () => parseScraperResult({
      status: 1,
      stdout: "",
      stderr: "Logging in...\nFatal: page.goto: Timeout 60000ms exceeded\n",
    }),
    /Scraper process failed \(exit code 1\)\nLogging in\.\.\.\nFatal: page\.goto: Timeout 60000ms exceeded/
  );
});

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

test("formatShift: multi-segment shift shows break", () => {
  assert.strictEqual(
    formatShift({
      start: "9:00", end: "14:05", off: false,
      segments: [{ start: "9:00", end: "13:00" }, { start: "13:25", end: "14:05" }],
    }),
    "9:00–14:05 (break 13:00–13:25)"
  );
});

test("formatShift: single segment uses start–end", () => {
  assert.strictEqual(
    formatShift({
      start: "9:00", end: "14:00", off: false,
      segments: [{ start: "9:00", end: "14:00" }],
    }),
    "9:00–14:00"
  );
});

// --- calculateDailyTotal ---

test("calculateDailyTotal: single clock pair on weekday", () => {
  assert.strictEqual(calculateDailyTotal({ day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }), "8:00");
});

test("calculateDailyTotal: two clock pairs on weekday", () => {
  const entry = { day: "Fri", clockIn1: "13:56", clockOut1: "16:36", clockIn2: "16:51", clockOut2: "19:26" };
  assert.strictEqual(calculateDailyTotal(entry), "5:15");
});

test("calculateDailyTotal: no complete pairs returns null", () => {
  assert.strictEqual(calculateDailyTotal({ clockIn1: "9:00", clockOut1: null }), null);
  assert.strictEqual(calculateDailyTotal({}), null);
});

test("calculateDailyTotal: short shift on weekday", () => {
  assert.strictEqual(calculateDailyTotal({ day: "Mon", clockIn1: "14:00", clockOut1: "14:30" }), "0:30");
});

test("calculateDailyTotal: adds 5min when hasScheduledBreak is true", () => {
  assert.strictEqual(calculateDailyTotal({ day: "Sat", clockIn1: "9:00", clockOut1: "13:01", clockIn2: "13:26", clockOut2: "14:05" }, true), "4:45");
  assert.strictEqual(calculateDailyTotal({ day: "Sun", clockIn1: "8:57", clockOut1: "11:43", clockIn2: "12:07", clockOut2: "14:15" }, true), "4:59");
  // Also works on weekdays with scheduled break
  assert.strictEqual(calculateDailyTotal({ day: "Mon", clockIn1: "9:00", clockOut1: "13:00", clockIn2: "13:25", clockOut2: "14:05" }, true), "4:45");
});

test("calculateDailyTotal: no bonus without hasScheduledBreak", () => {
  assert.strictEqual(calculateDailyTotal({ day: "Sat", clockIn1: "9:00", clockOut1: "13:01", clockIn2: "13:26", clockOut2: "14:05" }), "4:40");
  assert.strictEqual(calculateDailyTotal({ day: "Mon", clockIn1: "9:00", clockOut1: "13:00", clockIn2: "13:25", clockOut2: "14:05" }), "4:40");
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

test("detectScheduleChanges: segment change detected", () => {
  const oldData = { shifts: [{
    date: "2026-02-21", day: "Sat", start: "9:00", end: "14:05", off: false,
    segments: [{ start: "9:00", end: "13:00" }, { start: "13:25", end: "14:05" }],
  }] };
  const newData = { shifts: [{
    date: "2026-02-21", day: "Sat", start: "9:00", end: "14:05", off: false,
    segments: [{ start: "9:00", end: "13:00" }, { start: "13:30", end: "14:05" }],
  }] };
  const result = detectScheduleChanges(oldData, newData);
  assert.ok(result);
  assert.ok(result[0].includes("Changed"));
});

test("detectScheduleChanges: same segments returns null", () => {
  const data = { shifts: [{
    date: "2026-02-21", day: "Sat", start: "9:00", end: "14:05", off: false,
    segments: [{ start: "9:00", end: "13:00" }, { start: "13:25", end: "14:05" }],
  }] };
  assert.strictEqual(detectScheduleChanges(data, data), null);
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

test("detectTimecardDiscrepancy: compares clock pairs against segments", () => {
  const schedule = { shifts: [{
    date: "2026-02-21", day: "Sat", start: "9:00", end: "14:05", off: false,
    segments: [{ start: "9:00", end: "13:00" }, { start: "13:25", end: "14:05" }],
  }] };
  const timecard = { entries: [{
    date: "21/02", day: "Sat",
    clockIn1: "9:00", clockOut1: "13:01",
    clockIn2: "13:26", clockOut2: "14:05",
  }] };
  // All within threshold — should return null
  assert.strictEqual(detectTimecardDiscrepancy(schedule, timecard, "2026-02-21"), null);
});

test("detectTimecardDiscrepancy: second pair mismatch with segments", () => {
  const schedule = { shifts: [{
    date: "2026-02-21", day: "Sat", start: "9:00", end: "14:05", off: false,
    segments: [{ start: "9:00", end: "13:00" }, { start: "13:25", end: "14:05" }],
  }] };
  const timecard = { entries: [{
    date: "21/02", day: "Sat",
    clockIn1: "9:00", clockOut1: "13:01",
    clockIn2: "15:30", clockOut2: "17:00",
  }] };
  const result = detectTimecardDiscrepancy(schedule, timecard, "2026-02-21");
  assert.ok(result);
  assert.ok(result[0].includes("Clock In2"));
  assert.ok(result[0].includes("15:30"));
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

test("detectTimecardChanges: new entry skipped when times match schedule", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "21/02", day: "Sat", clockIn1: "8:03", clockOut1: "16:00", dailyTotal: "7:57" },
    ],
  };
  const schedule = {
    shifts: [{ date: "2026-02-21", day: "Sat", start: "8:00", end: "16:00", off: false }],
  };
  const result = detectTimecardChanges(oldData, newData, schedule);
  assert.strictEqual(result, null);
});

test("detectTimecardChanges: new entry reported when times differ from schedule", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "21/02", day: "Sat", clockIn1: "6:00", clockOut1: "16:00", dailyTotal: "10:00" },
    ],
  };
  const schedule = {
    shifts: [{ date: "2026-02-21", day: "Sat", start: "8:00", end: "16:00", off: false }],
  };
  const result = detectTimecardChanges(oldData, newData, schedule);
  assert.ok(result);
  assert.ok(result[0].includes("Sat 21 Feb"));
});

test("detectTimecardChanges: new leave entry on day off is skipped", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "03/03", day: "Tue", clockIn1: "00:00", clockOut1: null, payCode: "Annual Leave Request" },
    ],
  };
  const schedule = {
    shifts: [{ date: "2026-03-03", day: "Tue", start: null, end: null, off: true }],
  };
  const result = detectTimecardChanges(oldData, newData, schedule);
  assert.strictEqual(result, null);
});

test("detectTimecardChanges: new entry on day off with real clocks is reported", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "21/02", day: "Sat", clockIn1: "8:00", clockOut1: "16:00", dailyTotal: "8:00" },
    ],
  };
  const schedule = {
    shifts: [{ date: "2026-02-21", day: "Sat", start: null, end: null, off: true }],
  };
  const result = detectTimecardChanges(oldData, newData, schedule);
  assert.ok(result);
  assert.ok(result[0].includes("Sat 21 Feb"));
});

test("detectTimecardChanges: new leave entry skipped when date not in schedule", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "04/03", day: "Wed", clockIn1: "00:00", clockOut1: null, payCode: "Annual Leave Request" },
    ],
  };
  // Schedule exists but has no entry for 04/03
  const schedule = {
    shifts: [{ date: "2026-03-09", day: "Mon", start: "9:00", end: "14:00", off: false }],
  };
  const result = detectTimecardChanges(oldData, newData, schedule);
  assert.strictEqual(result, null);
});

test("detectTimecardChanges: without schedule data, behaves as before", () => {
  const oldData = { entries: [{ date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" }] };
  const newData = {
    entries: [
      { date: "20/02", day: "Fri", clockIn1: "9:00", clockOut1: "17:00" },
      { date: "21/02", day: "Sat", clockIn1: "8:00", clockOut1: "16:00", dailyTotal: "8:00" },
    ],
  };
  const result = detectTimecardChanges(oldData, newData);
  assert.ok(result);
  assert.ok(result[0].includes("Sat 21 Feb"));
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

test("detectTotalMismatch: scheduled break adds 5min bonus via cache", () => {
  const breakCache = {
    "2026-02-21": [{ start: "9:00", end: "13:00" }, { start: "13:25", end: "14:05" }],
  };
  const timecard = { entries: [{
    date: "21/02", day: "Sat",
    clockIn1: "9:00", clockOut1: "13:01", clockIn2: "13:26", clockOut2: "14:05",
    dailyTotal: "4:45",
  }] };
  assert.strictEqual(detectTotalMismatch(timecard, breakCache), null);
});

test("detectTotalMismatch: raw total matching reported total suppresses split-shift false positives", () => {
  const breakCache = {
    "2026-03-14": [{ start: "14:00", end: "17:30" }, { start: "17:45", end: "19:00" }],
  };
  const timecard = { entries: [{
    date: "14/03", day: "Sat",
    clockIn1: "14:21", clockOut1: "18:00", clockIn2: "18:10", clockOut2: "18:52",
    dailyTotal: "4:21",
  }] };
  assert.strictEqual(detectTotalMismatch(timecard, breakCache), null);
});

test("detectTotalMismatch: 1-minute drift is ignored", () => {
  const data = { entries: [{
    date: "28/03", day: "Sat",
    clockIn1: "08:59", clockOut1: "12:25", clockIn2: "13:26", clockOut2: "19:06",
    dailyTotal: "9:07",
  }] };
  assert.strictEqual(detectTotalMismatch(data), null);
});

test("detectTotalMismatch: no bonus when date not in break cache", () => {
  const breakCache = {};
  const timecard = { entries: [{
    date: "21/02", day: "Sat",
    clockIn1: "9:00", clockOut1: "13:01", clockIn2: "13:26", clockOut2: "14:05",
    dailyTotal: "4:45",
  }] };
  const result = detectTotalMismatch(timecard, breakCache);
  assert.ok(result);
  assert.ok(result[0].includes("4:40"));
});

test("detectTotalMismatch: no bonus without break cache at all", () => {
  const timecard = { entries: [{
    date: "21/02", day: "Sat",
    clockIn1: "9:00", clockOut1: "13:01", clockIn2: "13:26", clockOut2: "14:05",
    dailyTotal: "4:45",
  }] };
  const result = detectTotalMismatch(timecard);
  assert.ok(result);
  assert.ok(result[0].includes("4:40"));
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
