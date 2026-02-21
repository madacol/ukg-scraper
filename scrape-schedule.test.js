import { test } from "node:test";
import assert from "node:assert";

// --- Copy the pure helper functions from scrape-schedule.js for testing ---

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

function addDays(d, n) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

const WEEKS_TO_FETCH = 6;

function buildDateLookupForWeek(weekOffset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayNameMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const refDate = addDays(today, weekOffset * 7);
  const lookup = new Map();
  for (let i = -10; i <= 10; i++) {
    const d = addDays(refDate, i);
    const key = `${dayNameMap[d.getDay()]}_${d.getDate()}`;
    if (!lookup.has(key)) {
      lookup.set(key, formatDate(d));
    }
  }
  return lookup;
}

function parseDaysFromText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const days = [];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (
      dayNames.includes(line) &&
      i + 1 < lines.length &&
      /^\d{1,2}$/.test(lines[i + 1])
    ) {
      if (current) days.push(current);
      current = { day: line, dateNum: parseInt(lines[i + 1]), details: [] };
      i++;
      continue;
    }

    const sameLine = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})$/);
    if (sameLine) {
      if (current) days.push(current);
      current = { day: sameLine[1], dateNum: parseInt(sameLine[2]), details: [] };
      continue;
    }

    const longDate = line.match(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+\w+\s+(\d{1,2})/
    );
    if (longDate) {
      if (current) days.push(current);
      current = {
        day: longDate[1].substring(0, 3),
        dateNum: parseInt(longDate[2]),
        details: [],
      };
      continue;
    }

    if (current) {
      if (line === "Today") continue;
      current.details.push(line);
    }
  }
  if (current) days.push(current);
  return days;
}

// --- Tests ---

// --- parseDaysFromText ---

test("parseDaysFromText: day-off variations in details", () => {
  const text = `
    Mon
    2
    ROI Day Off Request TOR (Full)
    Tue
    3
    Scheduled Off
    Wed
    4
    Annual Leave
  `;
  const days = parseDaysFromText(text);
  assert.strictEqual(days.length, 3);
  assert.deepStrictEqual(days[0].details, ["ROI Day Off Request TOR (Full)"]);
  assert.deepStrictEqual(days[1].details, ["Scheduled Off"]);
  assert.deepStrictEqual(days[2].details, ["Annual Leave"]);
});

test("parseDaysFromText: pattern 1 — day name and date on separate lines", () => {
  const text = `
    Mon
    21
    9:00–17:00
    Dunnes Store
    Tue
    22
    Day Off
    Wed
    23
    10:00–18:00
  `;
  const days = parseDaysFromText(text);
  assert.strictEqual(days.length, 3);
  assert.deepStrictEqual(days[0], { day: "Mon", dateNum: 21, details: ["9:00–17:00", "Dunnes Store"] });
  assert.deepStrictEqual(days[1], { day: "Tue", dateNum: 22, details: ["Day Off"] });
  assert.deepStrictEqual(days[2], { day: "Wed", dateNum: 23, details: ["10:00–18:00"] });
});

test("parseDaysFromText: pattern 2 — day and date on same line", () => {
  const text = `
    Mon 21
    9:00–17:00
    Tue 22
    Day Off
  `;
  const days = parseDaysFromText(text);
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].day, "Mon");
  assert.strictEqual(days[0].dateNum, 21);
  assert.deepStrictEqual(days[0].details, ["9:00–17:00"]);
  assert.strictEqual(days[1].day, "Tue");
  assert.strictEqual(days[1].dateNum, 22);
});

test("parseDaysFromText: pattern 3 — long date format", () => {
  const text = `
    Monday, February 21
    9:00–17:00
    Tuesday, February 22
    nothing planned
  `;
  const days = parseDaysFromText(text);
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].day, "Mon");
  assert.strictEqual(days[0].dateNum, 21);
  assert.deepStrictEqual(days[0].details, ["9:00–17:00"]);
  assert.strictEqual(days[1].day, "Tue");
  assert.strictEqual(days[1].dateNum, 22);
  assert.deepStrictEqual(days[1].details, ["nothing planned"]);
});

test("parseDaysFromText: skips 'Today' lines", () => {
  const text = `
    Mon
    21
    Today
    9:00–17:00
  `;
  const days = parseDaysFromText(text);
  assert.strictEqual(days.length, 1);
  assert.deepStrictEqual(days[0].details, ["9:00–17:00"]);
});

test("parseDaysFromText: full 7-day week", () => {
  const text = `
    Mon
    17
    9:00–17:00
    Tue
    18
    9:00–17:00
    Wed
    19
    Day Off
    Thu
    20
    10:00–18:00
    Fri
    21
    9:00–17:00
    Sat
    22
    nothing planned
    Sun
    23
    nothing planned
  `;
  const days = parseDaysFromText(text);
  assert.strictEqual(days.length, 7);
  assert.strictEqual(days[0].day, "Mon");
  assert.strictEqual(days[6].day, "Sun");
  assert.strictEqual(days[6].dateNum, 23);
});

test("parseDaysFromText: empty text returns empty array", () => {
  assert.deepStrictEqual(parseDaysFromText(""), []);
  assert.deepStrictEqual(parseDaysFromText("   \n  \n  "), []);
});

test("parseDaysFromText: text with no schedule data returns empty array", () => {
  const text = "Welcome to UKG\nHome\nMy Accruals\nLoading complete";
  assert.deepStrictEqual(parseDaysFromText(text), []);
});

// --- buildDateLookupForWeek ---

test("buildDateLookupForWeek: returns a Map", () => {
  const lookup = buildDateLookupForWeek(0);
  assert.ok(lookup instanceof Map);
});

test("buildDateLookupForWeek: week 0 contains today", () => {
  const lookup = buildDateLookupForWeek(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayNameMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const key = `${dayNameMap[today.getDay()]}_${today.getDate()}`;
  assert.strictEqual(lookup.get(key), formatDate(today));
});

test("buildDateLookupForWeek: week 5 contains date 35 days from now", () => {
  const lookup = buildDateLookupForWeek(5);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayNameMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const future = addDays(today, 35);
  const key = `${dayNameMap[future.getDay()]}_${future.getDate()}`;
  assert.strictEqual(lookup.get(key), formatDate(future));
});

test("buildDateLookupForWeek: has 21 entries (±10 days window)", () => {
  const lookup = buildDateLookupForWeek(0);
  // 21 days in the window, but some (dayName, dayOfMonth) pairs could collide
  // within a 21-day window — actually they can't since the same pair repeats
  // only after 28+ days. So we get exactly 21 entries.
  assert.strictEqual(lookup.size, 21);
});

test("buildDateLookupForWeek: no collisions between week 0 and week 4 for same day-of-month", () => {
  // This is the key test: Feb 21 (Sat) and Mar 21 (Sat) should resolve
  // to different dates depending on which week we're looking at
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayNameMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const lookup0 = buildDateLookupForWeek(0);
  const lookup4 = buildDateLookupForWeek(4);

  const key = `${dayNameMap[today.getDay()]}_${today.getDate()}`;

  // Week 0 should resolve to today
  assert.strictEqual(lookup0.get(key), formatDate(today));

  // Week 4 (28 days later) — if the same dayName_dayOfMonth exists,
  // it should resolve to the date 28 days from now, not today
  const future = addDays(today, 28);
  const futureKey = `${dayNameMap[future.getDay()]}_${future.getDate()}`;
  if (futureKey === key) {
    // The collision case: same key but different expected dates per week
    assert.strictEqual(lookup4.get(futureKey), formatDate(future));
    assert.notStrictEqual(lookup0.get(key), lookup4.get(futureKey));
  }
});

// --- End-to-end: parsing + date resolution ---

test("end-to-end: parse week 0 text and resolve dates", () => {
  const lookup = buildDateLookupForWeek(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayNameMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Build a fake schedule page text using real upcoming dates
  const lines = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const dayName = dayNameMap[d.getDay()];
    lines.push(dayName);
    lines.push(String(d.getDate()));
    lines.push(i % 2 === 0 ? "9:00–17:00" : "Day Off");
  }

  const days = parseDaysFromText(lines.join("\n"));
  assert.strictEqual(days.length, 7);

  // Resolve dates
  const shifts = [];
  for (const rawDay of days) {
    const key = `${rawDay.day}_${rawDay.dateNum}`;
    const fullDate = lookup.get(key);
    assert.ok(fullDate, `Should resolve date for ${key}`);
    shifts.push({ date: fullDate, day: rawDay.day });
  }

  // Verify the first shift date is today
  assert.strictEqual(shifts[0].date, formatDate(today));
  // Verify the last shift date is 6 days from now
  assert.strictEqual(shifts[6].date, formatDate(addDays(today, 6)));
});

test("end-to-end: parse week 4 text and resolve dates across month boundary", () => {
  const lookup = buildDateLookupForWeek(4);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayNameMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Build schedule text for week 4 (days 28-34 from now)
  const lines = [];
  for (let i = 28; i < 35; i++) {
    const d = addDays(today, i);
    lines.push(dayNameMap[d.getDay()]);
    lines.push(String(d.getDate()));
    lines.push("9:00–17:00");
  }

  const days = parseDaysFromText(lines.join("\n"));
  assert.strictEqual(days.length, 7);

  for (let i = 0; i < 7; i++) {
    const d = addDays(today, 28 + i);
    const key = `${days[i].day}_${days[i].dateNum}`;
    const resolved = lookup.get(key);
    assert.strictEqual(resolved, formatDate(d), `Day ${i} of week 4 should resolve correctly`);
  }
});

test("end-to-end: all 6 weeks resolve without collisions", () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayNameMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (let week = 0; week < WEEKS_TO_FETCH; week++) {
    const lookup = buildDateLookupForWeek(week);

    // Check 7 days for this week
    for (let day = 0; day < 7; day++) {
      const offset = week * 7 + day;
      const d = addDays(today, offset);
      const key = `${dayNameMap[d.getDay()]}_${d.getDate()}`;
      const resolved = lookup.get(key);
      assert.strictEqual(
        resolved,
        formatDate(d),
        `Week ${week}, day ${day} (offset ${offset}): ${key} should be ${formatDate(d)}, got ${resolved}`
      );
    }
  }
});
