import { test } from "node:test";
import assert from "node:assert";
import { formatDate, addDays, mapApiToShifts } from "./schedule-utils.js";

// --- formatDate ---

test("formatDate: returns ISO date string", () => {
  assert.strictEqual(formatDate(new Date("2026-03-15T00:00:00")), "2026-03-15");
});

test("formatDate: ignores time component", () => {
  assert.strictEqual(formatDate(new Date("2026-03-15T23:59:59")), "2026-03-15");
});

// --- addDays ---

test("addDays: adds positive days", () => {
  const base = new Date("2026-02-21T00:00:00");
  const result = addDays(base, 5);
  assert.strictEqual(formatDate(result), "2026-02-26");
});

test("addDays: adds negative days", () => {
  const base = new Date("2026-02-21T00:00:00");
  const result = addDays(base, -3);
  assert.strictEqual(formatDate(result), "2026-02-18");
});

test("addDays: crosses month boundary", () => {
  const base = new Date("2026-02-26T00:00:00");
  const result = addDays(base, 5);
  assert.strictEqual(formatDate(result), "2026-03-03");
});

test("addDays: does not mutate original date", () => {
  const base = new Date("2026-02-21T00:00:00");
  addDays(base, 10);
  assert.strictEqual(formatDate(base), "2026-02-21");
});

// --- mapApiToShifts ---

test("mapApiToShifts: maps regular shifts with correct date, times, and day", () => {
  const apiResponse = {
    regularShifts: [
      {
        startDateTime: "2026-02-21T09:00:00",
        endDateTime: "2026-02-21T14:00:00",
      },
    ],
    holidayList: [],
    timeOffRequests: [],
  };
  const shifts = mapApiToShifts(apiResponse);
  assert.strictEqual(shifts.length, 1);
  assert.deepStrictEqual(shifts[0], {
    date: "2026-02-21",
    day: "Sat",
    start: "9:00",
    end: "14:00",
    off: false,
    note: null,
  });
});

test("mapApiToShifts: maps multiple regular shifts sorted by date", () => {
  const apiResponse = {
    regularShifts: [
      {
        startDateTime: "2026-02-23T14:00:00",
        endDateTime: "2026-02-23T20:00:00",
      },
      {
        startDateTime: "2026-02-21T09:00:00",
        endDateTime: "2026-02-21T14:00:00",
      },
    ],
    holidayList: [],
    timeOffRequests: [],
  };
  const shifts = mapApiToShifts(apiResponse);
  assert.strictEqual(shifts.length, 2);
  assert.strictEqual(shifts[0].date, "2026-02-21");
  assert.strictEqual(shifts[1].date, "2026-02-23");
});

test("mapApiToShifts: maps holidays as off days", () => {
  const apiResponse = {
    regularShifts: [],
    holidayList: [
      {
        date: "2026-03-17",
        holidays: [
          {
            displayName: "St. Patrick's Day",
          },
        ],
      },
    ],
    timeOffRequests: [],
  };
  const shifts = mapApiToShifts(apiResponse);
  assert.strictEqual(shifts.length, 1);
  assert.deepStrictEqual(shifts[0], {
    date: "2026-03-17",
    day: "Tue",
    start: null,
    end: null,
    off: true,
    note: "St. Patrick's Day",
  });
});

test("mapApiToShifts: maps time-off requests as off days", () => {
  const apiResponse = {
    regularShifts: [],
    holidayList: [],
    timeOffRequests: [
      {
        requestSubType: {
          localizedName: "ROI Day Off Request TOR",
        },
        currentStatus: {
          name: "Submitted",
        },
        periods: [
          { startDate: "2026-03-18" },
        ],
      },
    ],
  };
  const shifts = mapApiToShifts(apiResponse);
  assert.strictEqual(shifts.length, 1);
  assert.deepStrictEqual(shifts[0], {
    date: "2026-03-18",
    day: "Wed",
    start: null,
    end: null,
    off: true,
    note: "ROI Day Off Request TOR (Submitted)",
  });
});

test("mapApiToShifts: handles time-off with multiple periods", () => {
  const apiResponse = {
    regularShifts: [],
    holidayList: [],
    timeOffRequests: [
      {
        requestSubType: {
          localizedName: "Annual Leave",
        },
        currentStatus: {
          name: "Approved",
        },
        periods: [
          { startDate: "2026-03-19" },
          { startDate: "2026-03-20" },
        ],
      },
    ],
  };
  const shifts = mapApiToShifts(apiResponse);
  assert.strictEqual(shifts.length, 2);
  assert.strictEqual(shifts[0].date, "2026-03-19");
  assert.strictEqual(shifts[0].note, "Annual Leave (Approved)");
  assert.strictEqual(shifts[1].date, "2026-03-20");
  assert.strictEqual(shifts[1].note, "Annual Leave (Approved)");
});

test("mapApiToShifts: mixed shifts, holidays, and time-off sorted by date", () => {
  const apiResponse = {
    regularShifts: [
      {
        startDateTime: "2026-03-19T09:00:00",
        endDateTime: "2026-03-19T17:00:00",
      },
    ],
    holidayList: [
      {
        date: "2026-03-17",
        holidays: [{ displayName: "St. Patrick's Day" }],
      },
    ],
    timeOffRequests: [
      {
        requestSubType: { localizedName: "Day Off Request" },
        currentStatus: { name: "Approved" },
        periods: [{ startDate: "2026-03-18" }],
      },
    ],
  };
  const shifts = mapApiToShifts(apiResponse);
  assert.strictEqual(shifts.length, 3);
  assert.strictEqual(shifts[0].date, "2026-03-17");
  assert.strictEqual(shifts[0].off, true);
  assert.strictEqual(shifts[1].date, "2026-03-18");
  assert.strictEqual(shifts[1].off, true);
  assert.strictEqual(shifts[2].date, "2026-03-19");
  assert.strictEqual(shifts[2].off, false);
  assert.strictEqual(shifts[2].start, "9:00");
});

test("mapApiToShifts: empty response returns empty array", () => {
  const shifts = mapApiToShifts({
    regularShifts: [],
    holidayList: [],
    timeOffRequests: [],
  });
  assert.deepStrictEqual(shifts, []);
});

test("mapApiToShifts: handles missing arrays gracefully", () => {
  const shifts = mapApiToShifts({});
  assert.deepStrictEqual(shifts, []);
});

test("mapApiToShifts: deduplicates when shift and holiday fall on same date", () => {
  const apiResponse = {
    regularShifts: [
      {
        startDateTime: "2026-03-17T09:00:00",
        endDateTime: "2026-03-17T14:00:00",
      },
    ],
    holidayList: [
      {
        date: "2026-03-17",
        holidays: [{ displayName: "St. Patrick's Day" }],
      },
    ],
    timeOffRequests: [],
  };
  const shifts = mapApiToShifts(apiResponse);
  // Regular shift takes precedence — holiday note is added
  assert.strictEqual(shifts.length, 1);
  assert.strictEqual(shifts[0].date, "2026-03-17");
  assert.strictEqual(shifts[0].start, "9:00");
  assert.strictEqual(shifts[0].end, "14:00");
  assert.strictEqual(shifts[0].off, false);
  assert.strictEqual(shifts[0].note, "St. Patrick's Day");
});

test("mapApiToShifts: formats hours without leading zero", () => {
  const apiResponse = {
    regularShifts: [
      {
        startDateTime: "2026-02-21T08:00:00",
        endDateTime: "2026-02-21T16:30:00",
      },
    ],
    holidayList: [],
    timeOffRequests: [],
  };
  const shifts = mapApiToShifts(apiResponse);
  assert.strictEqual(shifts[0].start, "8:00");
  assert.strictEqual(shifts[0].end, "16:30");
});
