import { test } from "node:test";
import assert from "node:assert";
import { buildWebsiteViewModel, classifyShift, computeDayMinutes } from "./website/view-model.js";

test("buildWebsiteViewModel: summarizes latest schedule and timecard data", () => {
  const schedule = {
    extractedAt: "2026-03-24T21:00:17.312Z",
    shifts: [
      {
        date: "2026-03-29",
        day: "Sun",
        start: "9:00",
        end: "14:00",
        off: false,
        note: null,
        segments: [
          { start: "9:00", end: "12:30" },
          { start: "12:45", end: "14:00" },
        ],
      },
      {
        date: "2026-03-30",
        day: "Mon",
        start: "9:00",
        end: "14:00",
        off: false,
        note: null,
        segments: [
          { start: "9:00", end: "12:30" },
          { start: "12:45", end: "14:00" },
        ],
      },
      {
        date: "2026-03-31",
        day: "Tue",
        start: "9:00",
        end: "19:00",
        off: false,
        note: null,
        segments: [
          { start: "9:00", end: "16:30" },
          { start: "17:30", end: "19:00" },
        ],
      },
    ],
  };

  const timecard = {
    extractedAt: "2026-03-24T21:00:34.562Z",
    period: "Last 2 Weeks",
    entries: [
      {
        date: "20/03",
        day: "Fri",
        clockIn1: "13:58",
        clockOut1: "19:04",
        clockIn2: null,
        clockOut2: null,
        payCode: null,
        amount: null,
        shiftTotal: "5:06",
        dailyTotal: "5:06",
      },
      {
        date: "23/03",
        day: "Mon",
        clockIn1: "08:55",
        clockOut1: "12:27",
        clockIn2: "13:07",
        clockOut2: "14:43",
        payCode: null,
        amount: null,
        shiftTotal: "5:13",
        dailyTotal: "5:13",
      },
      {
        date: "24/03",
        day: "Tue",
        clockIn1: "09:00",
        clockOut1: "12:54",
        clockIn2: null,
        clockOut2: null,
        payCode: null,
        amount: null,
        shiftTotal: "3:54",
        dailyTotal: "3:54",
      },
    ],
  };

  const model = buildWebsiteViewModel({ schedule, timecard, now: "2026-03-30T12:00:00.000Z" });

  assert.strictEqual(model.todayIso, "2026-03-30");
  assert.strictEqual(model.nextShift?.date, "2026-03-30");
  assert.strictEqual(model.nextShift?.timeRange, "9:00 - 14:00");
  assert.strictEqual(model.scheduleSummary.upcomingCount, 2);
  assert.strictEqual(model.timecardSummary.trackedDays, 3);
  assert.strictEqual(model.timecardSummary.totalHours, "14:13");
  assert.ok(model.scheduleSummary.isStale);
  assert.ok(model.timecardSummary.isStale);
  assert.strictEqual(model.upcomingShifts[0].breakLabel, "Break 12:30 - 12:45");
  assert.strictEqual(model.recentEntries[1].punches, "08:55 - 12:27, 13:07 - 14:43");
});

test("buildWebsiteViewModel: handles missing files cleanly", () => {
  const model = buildWebsiteViewModel({ schedule: null, timecard: null, now: "2026-03-30T12:00:00.000Z" });

  assert.strictEqual(model.nextShift, null);
  assert.strictEqual(model.scheduleSummary.upcomingCount, 0);
  assert.strictEqual(model.timecardSummary.trackedDays, 0);
  assert.ok(model.issues.includes("Schedule data file is missing."));
  assert.ok(model.issues.includes("Timecard data file is missing."));
});

test("buildWebsiteViewModel: produces a unified timeline merging schedule and timecard", () => {
  const schedule = {
    extractedAt: "2026-03-28T21:00:00.000Z",
    shifts: [
      { date: "2026-03-27", day: "Fri", start: "9:00", end: "14:00", off: false, note: null, segments: [{ start: "9:00", end: "12:30" }, { start: "12:45", end: "14:00" }] },
      { date: "2026-03-28", day: "Sat", start: null, end: null, off: true, note: null },
      { date: "2026-03-29", day: "Sun", start: null, end: null, off: true, note: null },
      { date: "2026-03-30", day: "Mon", start: "9:00", end: "14:00", off: false, note: null, segments: [{ start: "9:00", end: "12:30" }, { start: "12:45", end: "14:00" }] },
      { date: "2026-03-31", day: "Tue", start: "9:00", end: "19:00", off: false, note: null },
      { date: "2026-04-01", day: "Wed", start: null, end: null, off: false, note: "Easter Holiday" },
    ],
  };

  const timecard = {
    extractedAt: "2026-03-30T19:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "27/03", day: "Fri", clockIn1: "08:55", clockOut1: "14:02", clockIn2: null, clockOut2: null, dailyTotal: "5:07" },
      { date: "30/03", day: "Mon", clockIn1: "08:59", clockOut1: "13:02", clockIn2: "13:32", clockOut2: "14:07", dailyTotal: "4:43" },
    ],
  };

  const model = buildWebsiteViewModel({ schedule, timecard, now: "2026-03-30T12:00:00.000Z" });

  // timelineDays should exist and be sorted by date ascending
  assert.ok(Array.isArray(model.timelineDays));
  assert.ok(model.timelineDays.length >= 6);

  const dates = model.timelineDays.map((d) => d.date);
  for (let i = 1; i < dates.length; i++) {
    assert.ok(dates[i] >= dates[i - 1], `Expected ${dates[i]} >= ${dates[i - 1]}`);
  }

  // Today should be marked
  const today = model.timelineDays.find((d) => d.isToday);
  assert.ok(today);
  assert.strictEqual(today.date, "2026-03-30");
  assert.strictEqual(today.timeRange, "9:00 - 14:00");
  assert.strictEqual(today.punches, "08:59 - 13:02, 13:32 - 14:07");
  assert.strictEqual(today.total, "4:43");

  // Past day with both schedule and timecard
  const fri27 = model.timelineDays.find((d) => d.date === "2026-03-27");
  assert.ok(fri27);
  assert.ok(fri27.isPast);
  assert.strictEqual(fri27.timeRange, "9:00 - 14:00");
  assert.strictEqual(fri27.punches, "08:55 - 14:02");
  assert.strictEqual(fri27.breakLabel, "Break 12:30 - 12:45");

  // Off day
  const sat28 = model.timelineDays.find((d) => d.date === "2026-03-28");
  assert.ok(sat28);
  assert.strictEqual(sat28.timeRange, "Off");

  // Future day
  const tue31 = model.timelineDays.find((d) => d.date === "2026-03-31");
  assert.ok(tue31);
  assert.ok(!tue31.isPast);
  assert.ok(!tue31.isToday);

  // Holiday note
  const wed01 = model.timelineDays.find((d) => d.date === "2026-04-01");
  assert.ok(wed01);
  assert.strictEqual(wed01.note, "Easter Holiday");
});

test("buildWebsiteViewModel: timelineDays includes timecard-only days not in schedule", () => {
  const model = buildWebsiteViewModel({
    schedule: { extractedAt: "2026-03-30T10:00:00.000Z", shifts: [] },
    timecard: {
      extractedAt: "2026-03-30T10:00:00.000Z",
      period: "Last 2 Weeks",
      entries: [
        { date: "25/03", day: "Wed", clockIn1: "09:00", clockOut1: "14:00", dailyTotal: "5:00" },
      ],
    },
    now: "2026-03-30T12:00:00.000Z",
  });

  const wed25 = model.timelineDays.find((d) => d.date === "2026-03-25");
  assert.ok(wed25, "Timecard-only days should appear in timeline");
  assert.strictEqual(wed25.punches, "09:00 - 14:00");
});

test("buildWebsiteViewModel: timelineDays uses timecard schedule field for past days", () => {
  const model = buildWebsiteViewModel({
    schedule: { extractedAt: "2026-03-30T10:00:00.000Z", shifts: [] },
    timecard: {
      extractedAt: "2026-03-30T10:00:00.000Z",
      period: "Last 2 Weeks",
      entries: [
        { date: "23/03", day: "Mon", schedule: "09:00 - 14:00", clockIn1: "08:55", clockOut1: "12:27", clockIn2: "13:07", clockOut2: "14:43", dailyTotal: "5:13" },
        { date: "24/03", day: "Tue", schedule: "09:00 - 19:00", clockIn1: "09:00", clockOut1: "11:40", clockIn2: "12:54", clockOut2: "18:38", dailyTotal: "8:24" },
        { date: "25/03", day: "Wed", schedule: null, clockIn1: null, clockOut1: null, dailyTotal: null },
      ],
    },
    now: "2026-03-30T12:00:00.000Z",
  });

  const mon23 = model.timelineDays.find((d) => d.date === "2026-03-23");
  assert.ok(mon23);
  assert.strictEqual(mon23.timeRange, "09:00 - 14:00", "Should use timecard schedule field as timeRange");
  assert.strictEqual(mon23.punches, "08:55 - 12:27, 13:07 - 14:43");

  const tue24 = model.timelineDays.find((d) => d.date === "2026-03-24");
  assert.ok(tue24);
  assert.strictEqual(tue24.timeRange, "09:00 - 19:00");

  // Null schedule should not set timeRange
  const wed25 = model.timelineDays.find((d) => d.date === "2026-03-25");
  assert.ok(wed25);
  assert.strictEqual(wed25.timeRange, null);
});

test("buildWebsiteViewModel: backfills missing past days between earliest timecard day and today", () => {
  const model = buildWebsiteViewModel({
    schedule: { extractedAt: "2026-03-30T10:00:00.000Z", shifts: [] },
    timecard: {
      extractedAt: "2026-03-30T10:00:00.000Z",
      period: "Last 30 Days",
      entries: [
        { date: "28/03", day: "Sat", dailyTotal: "4:00" },
        { date: "30/03", day: "Mon", dailyTotal: "5:00" },
      ],
    },
    now: "2026-03-30T12:00:00.000Z",
  });

  const sun29 = model.timelineDays.find((d) => d.date === "2026-03-29");
  assert.ok(sun29);
  assert.strictEqual(sun29.dateLabel, "Sun 29 Mar");
  assert.strictEqual(sun29.punches, null);
  assert.strictEqual(sun29.total, null);
});

// ── classifyShift ──

test("classifyShift: morning shift (9:00 - 14:00)", () => {
  assert.deepStrictEqual(classifyShift("9:00 - 14:00", false), { shiftType: "morning", isNonStandard: false });
});

test("classifyShift: evening shift (14:00 - 19:00)", () => {
  assert.deepStrictEqual(classifyShift("14:00 - 19:00", false), { shiftType: "evening", isNonStandard: false });
});

test("classifyShift: full day shift (9:00 - 19:00)", () => {
  assert.deepStrictEqual(classifyShift("9:00 - 19:00", false), { shiftType: "full", isNonStandard: false });
});

test("classifyShift: non-standard morning shift (9:00 - 15:30 = 6.5h)", () => {
  assert.deepStrictEqual(classifyShift("9:00 - 15:30", false), { shiftType: "morning", isNonStandard: true });
});

test("classifyShift: non-standard evening shift (14:00 - 20:00 = 6h)", () => {
  assert.deepStrictEqual(classifyShift("14:00 - 20:00", false), { shiftType: "evening", isNonStandard: true });
});

test("classifyShift: non-standard full day shift (9:00 - 20:00 = 11h)", () => {
  assert.deepStrictEqual(classifyShift("9:00 - 20:00", false), { shiftType: "full", isNonStandard: true });
});

test("classifyShift: off day", () => {
  assert.deepStrictEqual(classifyShift("Off", true), { shiftType: "off", isNonStandard: false });
});

test("classifyShift: off day with null timeRange", () => {
  assert.deepStrictEqual(classifyShift(null, true), { shiftType: "off", isNonStandard: false });
});

test("classifyShift: null timeRange, not off", () => {
  assert.deepStrictEqual(classifyShift(null, false), { shiftType: null, isNonStandard: false });
});

test("classifyShift: handles leading zeros (09:00 - 14:00)", () => {
  assert.deepStrictEqual(classifyShift("09:00 - 14:00", false), { shiftType: "morning", isNonStandard: false });
});

test("classifyShift: note string returns null type", () => {
  assert.deepStrictEqual(classifyShift("Easter Holiday", false), { shiftType: null, isNonStandard: false });
});

// ── computeDayMinutes ──

test("computeDayMinutes: uses total when available", () => {
  assert.strictEqual(computeDayMinutes({ total: "5:00", timeRange: "9:00 - 14:00" }), 300);
});

test("computeDayMinutes: falls back to timeRange for non-past days when no total", () => {
  assert.strictEqual(computeDayMinutes({ total: null, timeRange: "9:00 - 14:00", isPast: false }), 300);
});

test("computeDayMinutes: past scheduled day without total returns 0", () => {
  assert.strictEqual(computeDayMinutes({ total: null, timeRange: "9:00 - 14:00", isPast: true }), 0);
});

test("computeDayMinutes: returns 0 for Off", () => {
  assert.strictEqual(computeDayMinutes({ total: null, timeRange: "Off" }), 0);
});

test("computeDayMinutes: returns 0 for null timeRange", () => {
  assert.strictEqual(computeDayMinutes({ total: null, timeRange: null }), 0);
});

test("computeDayMinutes: handles leading zeros in timeRange", () => {
  assert.strictEqual(computeDayMinutes({ total: null, timeRange: "09:00 - 19:00", isPast: false }), 600);
});

test("buildWebsiteViewModel: weekGroups do not count past scheduled days without timecard totals", () => {
  const schedule = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    shifts: [
      { date: "2026-03-29", day: "Sun", start: "9:00", end: "14:00", off: false, note: null },
      { date: "2026-03-30", day: "Mon", start: "9:00", end: "14:00", off: false, note: null },
    ],
  };

  const timecard = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "29/03", day: "Sun", clockIn1: null, clockOut1: null, dailyTotal: null },
      { date: "30/03", day: "Mon", clockIn1: "09:00", clockOut1: "14:00", dailyTotal: "5:00" },
    ],
  };

  const model = buildWebsiteViewModel({ schedule, timecard, now: "2026-03-30T12:00:00.000Z" });
  const week = model.weekGroups.find((group) => group.weekLabel.includes("23") && group.weekLabel.includes("29"));
  assert.ok(week);
  assert.strictEqual(week.totalFormatted, "");
});

// ── shiftType in timelineDays ──

test("buildWebsiteViewModel: timelineDays include shiftType classification", () => {
  const schedule = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    shifts: [
      { date: "2026-03-30", day: "Mon", start: "9:00", end: "14:00", off: false, note: null },
      { date: "2026-03-31", day: "Tue", start: "14:00", end: "19:00", off: false, note: null },
      { date: "2026-04-01", day: "Wed", start: "9:00", end: "19:00", off: false, note: null },
      { date: "2026-04-02", day: "Thu", start: null, end: null, off: true, note: null },
    ],
  };

  const model = buildWebsiteViewModel({ schedule, timecard: null, now: "2026-03-30T12:00:00.000Z" });

  const mon = model.timelineDays.find((d) => d.date === "2026-03-30");
  assert.strictEqual(mon?.shiftType, "morning");
  assert.strictEqual(mon?.isNonStandard, false);

  const tue = model.timelineDays.find((d) => d.date === "2026-03-31");
  assert.strictEqual(tue?.shiftType, "evening");

  const wed = model.timelineDays.find((d) => d.date === "2026-04-01");
  assert.strictEqual(wed?.shiftType, "full");

  const thu = model.timelineDays.find((d) => d.date === "2026-04-02");
  assert.strictEqual(thu?.shiftType, "off");
});

// ── weekGroups ──

test("buildWebsiteViewModel: weekGroups groups days Monday to Sunday with totals", () => {
  const schedule = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    shifts: [
      // Week of Mon 23 Mar - Sun 29 Mar
      { date: "2026-03-27", day: "Fri", start: "9:00", end: "14:00", off: false, note: null },
      { date: "2026-03-28", day: "Sat", start: null, end: null, off: true, note: null },
      { date: "2026-03-29", day: "Sun", start: null, end: null, off: true, note: null },
      // Week of Mon 30 Mar - Sun 5 Apr
      { date: "2026-03-30", day: "Mon", start: "9:00", end: "14:00", off: false, note: null },
      { date: "2026-03-31", day: "Tue", start: "14:00", end: "19:00", off: false, note: null },
      { date: "2026-04-01", day: "Wed", start: null, end: null, off: true, note: null },
      // Week of Mon 6 Apr - Sun 12 Apr
      { date: "2026-04-06", day: "Mon", start: "9:00", end: "19:00", off: false, note: null },
    ],
  };

  const timecard = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "27/03", day: "Fri", clockIn1: "09:00", clockOut1: "13:58", dailyTotal: "4:58" },
      { date: "30/03", day: "Mon", clockIn1: "09:00", clockOut1: "14:00", dailyTotal: "5:00" },
    ],
  };

  const model = buildWebsiteViewModel({ schedule, timecard, now: "2026-03-30T12:00:00.000Z" });

  assert.ok(Array.isArray(model.weekGroups));
  assert.strictEqual(model.weekGroups.length, 3);

  // First week: Mon 23 - Sun 29 (Fri 27, Sat 28, Sun 29 — no earlier gaps to fill)
  const week1 = model.weekGroups[0];
  assert.ok(week1.weekLabel.includes("23"));
  assert.ok(week1.weekLabel.includes("29"));
  assert.strictEqual(week1.days.length, 3);
  // Fri 27 has clocked total 4:58 = 298 min
  assert.strictEqual(week1.totalFormatted, "4:58");

  // Second week: Mon 30 - Sun 5 (all 7 days filled: Mon 30, Tue 31, Wed 1, Thu 2, Fri 3, Sat 4, Sun 5)
  const week2 = model.weekGroups[1];
  assert.ok(week2.weekLabel.includes("30"));
  assert.ok(week2.weekLabel.includes("5"));
  assert.strictEqual(week2.days.length, 7);
  // Mon 30 clocked 5:00 + Tue 31 scheduled 5:00 = 10:00 (gap days add 0)
  assert.strictEqual(week2.totalFormatted, "10:00");

  // Third week: Mon 6 - Sun 12 (only Mon 6)
  const week3 = model.weekGroups[2];
  assert.strictEqual(week3.days.length, 1);
  // Mon 6 scheduled 10h
  assert.strictEqual(week3.totalFormatted, "10:00");
});

test("buildWebsiteViewModel: weekGroups handles empty data", () => {
  const model = buildWebsiteViewModel({ schedule: null, timecard: null, now: "2026-03-30T12:00:00.000Z" });
  assert.deepStrictEqual(model.weekGroups, []);
});

test("buildWebsiteViewModel: weekGroups week label spans month boundaries", () => {
  const schedule = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    shifts: [
      { date: "2026-03-30", day: "Mon", start: "9:00", end: "14:00", off: false, note: null },
      { date: "2026-04-01", day: "Wed", start: "14:00", end: "19:00", off: false, note: null },
    ],
  };

  const model = buildWebsiteViewModel({ schedule, timecard: null, now: "2026-03-30T12:00:00.000Z" });

  assert.strictEqual(model.weekGroups.length, 1);
  // Mon 30 Mar - Sun 5 Apr
  assert.ok(model.weekGroups[0].weekLabel.includes("Mar"));
  assert.ok(model.weekGroups[0].weekLabel.includes("Apr"));
});

// ── Fill all days (including unscheduled free days) ──

test("buildWebsiteViewModel: fills all gaps between earliest and latest day", () => {
  const schedule = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    shifts: [
      { date: "2026-03-30", day: "Mon", start: "9:00", end: "14:00", off: false, note: null },
      // Tue 31, Wed 1, Thu 2 are not scheduled at all
      { date: "2026-04-03", day: "Fri", start: "14:00", end: "19:00", off: false, note: null },
    ],
  };

  const model = buildWebsiteViewModel({ schedule, timecard: null, now: "2026-03-30T12:00:00.000Z" });

  const dates = model.timelineDays.map((d) => d.date);
  // Should include every day from Mar 30 to Apr 3 (5 days)
  assert.ok(dates.includes("2026-03-30"));
  assert.ok(dates.includes("2026-03-31"), "Tue 31 should be filled in");
  assert.ok(dates.includes("2026-04-01"), "Wed 1 should be filled in");
  assert.ok(dates.includes("2026-04-02"), "Thu 2 should be filled in");
  assert.ok(dates.includes("2026-04-03"));
  assert.strictEqual(dates.length, 5);

  // Gap-filled days should have no schedule and shiftType null
  const tue31 = model.timelineDays.find((d) => d.date === "2026-03-31");
  assert.ok(tue31);
  assert.strictEqual(tue31.timeRange, null);
  assert.strictEqual(tue31.shiftType, null);
  assert.strictEqual(tue31.dateLabel, "Tue 31 Mar");
});

test("buildWebsiteViewModel: fills past gaps between timecard and schedule", () => {
  const schedule = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    shifts: [
      { date: "2026-03-30", day: "Mon", start: "9:00", end: "14:00", off: false, note: null },
      { date: "2026-04-06", day: "Mon", start: "9:00", end: "14:00", off: false, note: null },
    ],
  };

  const timecard = {
    extractedAt: "2026-03-30T10:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "25/03", day: "Wed", clockIn1: "09:00", clockOut1: "14:00", dailyTotal: "5:00" },
    ],
  };

  const model = buildWebsiteViewModel({ schedule, timecard, now: "2026-03-30T12:00:00.000Z" });

  const dates = model.timelineDays.map((d) => d.date);
  // Should span from Mar 25 (earliest timecard) to Apr 6 (latest schedule)
  // That's 13 days: Mar 25–31 (7) + Apr 1–6 (6)
  assert.strictEqual(dates.length, 13);
  assert.strictEqual(dates[0], "2026-03-25");
  assert.strictEqual(dates[dates.length - 1], "2026-04-06");

  // Spot-check a gap day
  const thu26 = model.timelineDays.find((d) => d.date === "2026-03-26");
  assert.ok(thu26, "Thu 26 should be filled in");
  assert.strictEqual(thu26.dateLabel, "Thu 26 Mar");
});

test("buildWebsiteViewModel: sorts recent entries across month boundaries", () => {
  const model = buildWebsiteViewModel({
    schedule: null,
    timecard: {
      extractedAt: "2026-03-02T09:00:00.000Z",
      period: "Last 2 Weeks",
      entries: [
        { date: "28/02", day: "Sat", dailyTotal: "4:00" },
        { date: "01/03", day: "Sun", dailyTotal: "5:00" },
        { date: "27/02", day: "Fri", dailyTotal: "3:00" },
      ],
    },
    now: "2026-03-02T12:00:00.000Z",
  });

  assert.deepStrictEqual(
    model.recentEntries.map((entry) => entry.dateLabel),
    ["Sun 1 Mar", "Sat 28 Feb", "Fri 27 Feb"]
  );
});
