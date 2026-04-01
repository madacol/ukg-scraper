import { afterEach, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildBreakSegmentsFromStore,
  buildScheduleDataFromStore,
  buildTimecardDataFromStore,
  getDayFilePath,
  migrateLegacyData,
  persistScheduleData,
  persistTimecardData,
  writeDayIndex,
} from "./day-store.js";

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

/**
 * @returns {string}
 */
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ukg-day-store-"));
  tempDirs.push(dir);
  return dir;
}

test("persistScheduleData: stores one file per day and records history", () => {
  const dataDir = makeTempDir();

  persistScheduleData(dataDir, {
    extractedAt: "2026-03-30T21:00:00.000Z",
    shifts: [{
      date: "2026-03-30",
      day: "Mon",
      start: "9:00",
      end: "14:00",
      off: false,
      note: null,
      segments: [{ start: "9:00", end: "14:00" }],
    }],
  });

  persistScheduleData(dataDir, {
    extractedAt: "2026-03-31T21:00:00.000Z",
    shifts: [{
      date: "2026-03-30",
      day: "Mon",
      start: "10:00",
      end: "15:00",
      off: false,
      note: null,
      segments: [{ start: "10:00", end: "15:00" }],
    }],
  });

  const stored = JSON.parse(fs.readFileSync(getDayFilePath(dataDir, "2026-03-30"), "utf8"));
  assert.strictEqual(stored.date, "2026-03-30");
  assert.strictEqual(stored.current.schedule.start, "10:00");
  assert.strictEqual(stored.history.length, 2);
  assert.strictEqual(stored.history[0].type, "created");
  assert.strictEqual(stored.history[1].type, "updated");
  assert.deepStrictEqual(stored.history[1].changes.start, { from: "9:00", to: "10:00" });
});

test("persistTimecardData: writes current timecard state and avoids duplicate history on unchanged data", () => {
  const dataDir = makeTempDir();

  const payload = {
    extractedAt: "2026-03-31T21:00:00.000Z",
    entries: [{
      date: "30/03",
      day: "Mon",
      clockIn1: "9:00",
      clockOut1: "14:00",
      dailyTotal: "5:00",
    }],
  };

  persistTimecardData(dataDir, payload);
  persistTimecardData(dataDir, payload);

  const stored = JSON.parse(fs.readFileSync(getDayFilePath(dataDir, "2026-03-30"), "utf8"));
  assert.strictEqual(stored.current.timecard.clockIn1, "9:00");
  assert.strictEqual(stored.history.length, 1);
  assert.strictEqual(stored.history[0].source, "timecard");
});

test("persistTimecardData: preserves completely empty timecard rows", () => {
  const dataDir = makeTempDir();

  persistTimecardData(dataDir, {
    extractedAt: "2026-03-24T21:00:34.562Z",
    entries: [{
      date: "16/03",
      day: "Mon",
      schedule: null,
      absence: null,
      clockIn1: null,
      clockOut1: null,
      clockIn2: null,
      clockOut2: null,
      payCode: null,
      amount: null,
      shiftTotal: null,
      dailyTotal: null,
    }],
  });

  const stored = JSON.parse(fs.readFileSync(getDayFilePath(dataDir, "2026-03-16"), "utf8"));
  assert.deepStrictEqual(stored.current.timecard, {
    schedule: null,
    absence: null,
    clockIn1: null,
    clockOut1: null,
    clockIn2: null,
    clockOut2: null,
    payCode: null,
    amount: null,
    shiftTotal: null,
    dailyTotal: null,
  });
});

test("buildScheduleDataFromStore and buildTimecardDataFromStore: rebuild aggregate views from day files", () => {
  const dataDir = makeTempDir();

  persistScheduleData(dataDir, {
    extractedAt: "2026-03-31T20:00:00.000Z",
    shifts: [{
      date: "2026-03-31",
      day: "Tue",
      start: "9:00",
      end: "19:00",
      off: false,
      note: null,
      segments: [{ start: "9:00", end: "16:30" }, { start: "17:30", end: "19:00" }],
    }],
  });

  persistTimecardData(dataDir, {
    extractedAt: "2026-03-31T21:00:00.000Z",
    entries: [{
      date: "30/03",
      day: "Mon",
      clockIn1: "8:59",
      clockOut1: "13:02",
      clockIn2: "13:32",
      clockOut2: "14:07",
      dailyTotal: "4:43",
    }],
  });

  const schedule = buildScheduleDataFromStore(dataDir);
  const timecard = buildTimecardDataFromStore(dataDir);

  assert.ok(schedule);
  assert.ok(timecard);
  assert.strictEqual(schedule.shifts[0].date, "2026-03-31");
  assert.strictEqual(timecard.entries[0].date, "30/03");
  assert.strictEqual(timecard.entries[0].isoDate, "2026-03-30");
  assert.strictEqual(timecard.extractedAt, "2026-03-31T21:00:00.000Z");
});

test("buildBreakSegmentsFromStore: returns split-shift segments by ISO date", () => {
  const dataDir = makeTempDir();

  persistScheduleData(dataDir, {
    extractedAt: "2026-03-31T20:00:00.000Z",
    shifts: [{
      date: "2026-03-29",
      day: "Sun",
      start: "9:00",
      end: "14:00",
      off: false,
      note: null,
      segments: [{ start: "9:00", end: "12:30" }, { start: "12:45", end: "14:00" }],
    }],
  });

  assert.deepStrictEqual(buildBreakSegmentsFromStore(dataDir), {
    "2026-03-29": [{ start: "9:00", end: "12:30" }, { start: "12:45", end: "14:00" }],
  });
});

test("writeDayIndex: lists stored dates without duplicating day contents", () => {
  const dataDir = makeTempDir();

  persistScheduleData(dataDir, {
    extractedAt: "2026-03-30T21:00:00.000Z",
    shifts: [{
      date: "2026-03-30",
      day: "Mon",
      start: "9:00",
      end: "14:00",
      off: false,
      note: null,
    }],
  });

  persistTimecardData(dataDir, {
    extractedAt: "2026-03-31T21:00:00.000Z",
    entries: [{
      date: "31/03",
      day: "Tue",
      clockIn1: "9:00",
      clockOut1: "14:00",
      dailyTotal: "5:00",
    }],
  });

  const indexPath = writeDayIndex(dataDir);
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

  assert.deepStrictEqual(index.dates, ["2026-03-30", "2026-03-31"]);
});

test("migrateLegacyData: rebuilds day files from legacy snapshots and preserves live store as final state", () => {
  const dataDir = makeTempDir();

  fs.writeFileSync(path.join(dataDir, "schedule-2026-03-24.json"), JSON.stringify({
    extractedAt: "2026-03-24T21:00:17.312Z",
    shifts: [{
      date: "2026-03-30",
      day: "Mon",
      start: "9:00",
      end: "14:00",
      off: false,
      note: null,
      segments: [{ start: "9:00", end: "14:00" }],
    }],
  }, null, 2));

  fs.writeFileSync(path.join(dataDir, "timecard-2026-03-24.json"), JSON.stringify({
    extractedAt: "2026-03-24T21:00:34.562Z",
    period: "Last 2 Weeks",
    entries: [{
      date: "24/03",
      day: "Tue",
      schedule: "09:00 - 19:00",
      clockIn1: "09:00",
      clockOut1: "12:54",
      dailyTotal: "3:54",
    }],
  }, null, 2));

  // Simulate the live store written before migration.
  persistTimecardData(dataDir, {
    extractedAt: "2026-03-31T17:45:33.773Z",
    entries: [{
      date: "24/03",
      day: "Tue",
      schedule: "09:00 - 19:00",
      clockIn1: "09:00",
      clockOut1: "19:00",
      dailyTotal: "10:00",
    }],
  });
  writeDayIndex(dataDir);

  const result = migrateLegacyData(dataDir);

  assert.strictEqual(result.migratedScheduleFiles, 1);
  assert.strictEqual(result.migratedTimecardFiles, 1);
  assert.ok(result.backupDaysDir);
  assert.ok(result.backupIndexPath);

  const migrated = JSON.parse(fs.readFileSync(getDayFilePath(dataDir, "2026-03-24"), "utf8"));
  assert.strictEqual(migrated.current.timecard.dailyTotal, "10:00");
  assert.strictEqual(migrated.history.length, 2);
  assert.strictEqual(migrated.history[0].recordedAt, "2026-03-24T21:00:34.562Z");
  assert.strictEqual(migrated.history[1].recordedAt, "2026-03-31T17:45:33.773Z");
  assert.deepStrictEqual(migrated.history[1].changes.dailyTotal, { from: "3:54", to: "10:00" });
});
