import { test } from "node:test";
import assert from "node:assert";
import { buildWebsiteViewModel } from "./website/view-model.js";

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
