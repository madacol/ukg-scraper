import { afterEach, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import { buildWebsiteTimecardData } from "./website-data.js";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ukg-website-data-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * @param {string} dataDir
 * @param {string} date
 * @param {object} payload
 */
function writeSnapshot(dataDir, date, payload) {
  fs.writeFileSync(
    path.join(dataDir, `timecard-${date}.json`),
    JSON.stringify(payload, null, 2)
  );
}

test("buildWebsiteTimecardData: merges archived snapshots into a 30-day window", () => {
  const dataDir = makeTempDir();

  writeSnapshot(dataDir, "2026-03-10", {
    extractedAt: "2026-03-10T21:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "02/03", day: "Mon", dailyTotal: "5:00" },
      { date: "10/03", day: "Tue", dailyTotal: "4:00" },
    ],
  });

  writeSnapshot(dataDir, "2026-03-20", {
    extractedAt: "2026-03-20T21:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "10/03", day: "Tue", dailyTotal: "4:15" },
      { date: "20/03", day: "Fri", dailyTotal: "6:00" },
    ],
  });

  writeSnapshot(dataDir, "2026-03-30", {
    extractedAt: "2026-03-30T21:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "23/03", day: "Mon", dailyTotal: "5:13" },
      { date: "30/03", day: "Mon", dailyTotal: "4:43" },
    ],
  });

  const result = buildWebsiteTimecardData({
    dataDir,
    todayIso: "2026-03-30",
    windowDays: 30,
  });

  assert.ok(result);
  assert.strictEqual(result.extractedAt, "2026-03-30T21:00:00.000Z");
  assert.strictEqual(result.period, "Last 30 Days");
  assert.deepStrictEqual(
    result.entries.map((entry) => [entry.date, entry.dailyTotal]),
    [
      ["02/03", "5:00"],
      ["10/03", "4:15"],
      ["20/03", "6:00"],
      ["23/03", "5:13"],
      ["30/03", "4:43"],
    ]
  );
});

test("buildWebsiteTimecardData: excludes entries older than the requested window", () => {
  const dataDir = makeTempDir();

  writeSnapshot(dataDir, "2026-03-01", {
    extractedAt: "2026-03-01T21:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "28/02", day: "Sat", dailyTotal: "4:00" },
      { date: "01/03", day: "Sun", dailyTotal: "5:00" },
    ],
  });

  writeSnapshot(dataDir, "2026-03-30", {
    extractedAt: "2026-03-30T21:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "30/03", day: "Mon", dailyTotal: "4:43" },
    ],
  });

  const result = buildWebsiteTimecardData({
    dataDir,
    todayIso: "2026-03-30",
    windowDays: 30,
  });

  assert.ok(result);
  assert.deepStrictEqual(
    result.entries.map((entry) => entry.date),
    ["01/03", "30/03"]
  );
});

test("buildWebsiteTimecardData: resolves December entries for January snapshots", () => {
  const dataDir = makeTempDir();

  writeSnapshot(dataDir, "2026-01-05", {
    extractedAt: "2026-01-05T21:00:00.000Z",
    period: "Last 2 Weeks",
    entries: [
      { date: "31/12", day: "Wed", dailyTotal: "5:00" },
      { date: "05/01", day: "Mon", dailyTotal: "4:00" },
    ],
  });

  const result = buildWebsiteTimecardData({
    dataDir,
    todayIso: "2026-01-05",
    windowDays: 10,
  });

  assert.ok(result);
  assert.deepStrictEqual(
    result.entries.map((entry) => entry.date),
    ["31/12", "05/01"]
  );
});
