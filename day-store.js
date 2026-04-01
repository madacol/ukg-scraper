import fs from "fs";
import path from "path";

const DAYS_DIR_NAME = "days";
const DAY_INDEX_FILE = "index.json";

/**
 * @param {string} isoDate
 * @param {number} days
 * @returns {string}
 */
function addIsoDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {string} isoDate
 * @returns {string}
 */
function isoToDdmm(isoDate) {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
}

/**
 * Resolve a DD/MM date string to an ISO date using the reference date's year.
 * Handles the Dec -> Jan boundary for snapshots taken in January.
 * @param {string} ddmm
 * @param {string} referenceIso
 * @returns {string}
 */
function resolveDdmmIso(ddmm, referenceIso) {
  const [dayText, monthText] = ddmm.split("/").map(Number);
  let year = parseInt(referenceIso.slice(0, 4), 10);
  const referenceMonth = parseInt(referenceIso.slice(5, 7), 10);

  if (monthText === 12 && referenceMonth === 1) {
    year -= 1;
  }

  return `${year}-${String(monthText).padStart(2, "0")}-${String(dayText).padStart(2, "0")}`;
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
function getDaysDir(dataDir) {
  return path.join(dataDir, DAYS_DIR_NAME);
}

/**
 * @param {string} dataDir
 * @param {string} isoDate
 * @returns {string}
 */
function getDayFilePath(dataDir, isoDate) {
  return path.join(getDaysDir(dataDir), `${isoDate}.json`);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  return JSON.stringify(value ?? null);
}

/**
 * @param {Record<string, unknown> | null | undefined} previous
 * @param {Record<string, unknown> | null | undefined} next
 * @returns {Record<string, { from: unknown, to: unknown }>}
 */
function buildChangeSet(previous, next) {
  const changes = {};
  const keys = new Set([
    ...Object.keys(previous ?? {}),
    ...Object.keys(next ?? {}),
  ]);

  for (const key of keys) {
    const from = previous?.[key] ?? null;
    const to = next?.[key] ?? null;
    if (stableStringify(from) !== stableStringify(to)) {
      changes[key] = { from, to };
    }
  }

  return changes;
}

/**
 * @param {string} dataDir
 * @param {string} isoDate
 * @returns {object | null}
 */
function loadDayRecord(dataDir, isoDate) {
  const filePath = getDayFilePath(dataDir, isoDate);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * @param {string} dataDir
 * @param {object} record
 * @returns {void}
 */
function saveDayRecord(dataDir, record) {
  fs.mkdirSync(getDaysDir(dataDir), { recursive: true });
  fs.writeFileSync(
    getDayFilePath(dataDir, /** @type {{ date: string }} */ (record).date),
    JSON.stringify(record, null, 2)
  );
}

/**
 * @param {string} dataDir
 * @returns {string[]}
 */
function listStoredDates(dataDir) {
  const daysDir = getDaysDir(dataDir);
  if (!fs.existsSync(daysDir)) {
    return [];
  }

  return fs.readdirSync(daysDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.slice(0, -5))
    .sort();
}

/**
 * @param {string} dataDir
 * @param {{ from?: string, to?: string }} [options]
 * @returns {object[]}
 */
function loadDayRecords(dataDir, options = {}) {
  return listStoredDates(dataDir)
    .filter((isoDate) => (!options.from || isoDate >= options.from) && (!options.to || isoDate <= options.to))
    .map((isoDate) => loadDayRecord(dataDir, isoDate))
    .filter(Boolean);
}

/**
 * @param {object} shift
 * @returns {object}
 */
function normalizeScheduleValue(shift) {
  const { date, day, ...rest } = shift;
  return rest;
}

/**
 * @param {object} entry
 * @returns {object}
 */
function normalizeTimecardValue(entry) {
  const { date, day, isoDate, ...rest } = entry;
  return rest;
}

/**
 * @param {string} dataDir
 * @param {{
 *   isoDate: string,
 *   day: string,
 *   source: "schedule" | "timecard",
 *   extractedAt: string,
 *   value: object,
 * }} input
 * @returns {{ changed: boolean, record: object }}
 */
function updateDayRecord(dataDir, input) {
  const existing = loadDayRecord(dataDir, input.isoDate);
  const current = existing?.current?.[input.source] ?? null;
  const changes = buildChangeSet(current, input.value);
  const changed = Object.keys(changes).length > 0;
  const sourceKey = `${input.source}ExtractedAt`;

  const record = existing ?? {
    date: input.isoDate,
    day: input.day,
    current: {
      schedule: null,
      timecard: null,
    },
    sources: {
      scheduleExtractedAt: null,
      timecardExtractedAt: null,
      updatedAt: null,
    },
    history: [],
  };

  record.day = input.day;
  record.current[input.source] = input.value;
  record.sources[sourceKey] = input.extractedAt;
  record.sources.updatedAt = !record.sources.updatedAt || input.extractedAt > record.sources.updatedAt
    ? input.extractedAt
    : record.sources.updatedAt;

  if (changed) {
    record.history.push({
      recordedAt: input.extractedAt,
      source: input.source,
      type: current ? "updated" : "created",
      changes,
    });
  }

  saveDayRecord(dataDir, record);
  return { changed, record };
}

/**
 * @param {string} dataDir
 * @param {{ extractedAt: string, shifts: object[] }} scheduleData
 * @returns {{ changedDates: string[] }}
 */
function persistScheduleData(dataDir, scheduleData) {
  const changedDates = [];

  for (const shift of scheduleData.shifts) {
    const result = updateDayRecord(dataDir, {
      isoDate: shift.date,
      day: shift.day,
      source: "schedule",
      extractedAt: scheduleData.extractedAt,
      value: normalizeScheduleValue(shift),
    });

    if (result.changed) {
      changedDates.push(shift.date);
    }
  }

  return { changedDates };
}

/**
 * @param {string} dataDir
 * @param {{ extractedAt: string, entries: object[] }} timecardData
 * @returns {{ changedDates: string[] }}
 */
function persistTimecardData(dataDir, timecardData) {
  const changedDates = [];
  const referenceIso = timecardData.extractedAt.slice(0, 10);

  for (const entry of timecardData.entries) {
    const value = normalizeTimecardValue(entry);
    const isoDate = typeof entry.isoDate === "string"
      ? entry.isoDate
      : resolveDdmmIso(entry.date, referenceIso);
    const result = updateDayRecord(dataDir, {
      isoDate,
      day: entry.day,
      source: "timecard",
      extractedAt: timecardData.extractedAt,
      value,
    });

    if (result.changed) {
      changedDates.push(isoDate);
    }
  }

  return { changedDates };
}

/**
 * @param {string} dataDir
 * @returns {{ extractedAt: string, shifts: object[] } | null}
 */
function buildScheduleDataFromStore(dataDir) {
  const records = loadDayRecords(dataDir);
  let extractedAt = null;

  const shifts = records
    .filter((record) => record.current?.schedule)
    .map((record) => {
      if (record.sources?.scheduleExtractedAt && (!extractedAt || record.sources.scheduleExtractedAt > extractedAt)) {
        extractedAt = record.sources.scheduleExtractedAt;
      }

      return {
        date: record.date,
        day: record.day,
        ...record.current.schedule,
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date));

  if (!extractedAt || shifts.length === 0) {
    return null;
  }

  return { extractedAt, shifts };
}

/**
 * @param {string} dataDir
 * @param {{ from?: string, to?: string, period?: string }} [options]
 * @returns {{ extractedAt: string, period: string, entries: object[] } | null}
 */
function buildTimecardDataFromStore(dataDir, options = {}) {
  const records = loadDayRecords(dataDir, options);
  let extractedAt = null;

  const entries = records
    .filter((record) => record.current?.timecard)
    .map((record) => {
      if (record.sources?.timecardExtractedAt && (!extractedAt || record.sources.timecardExtractedAt > extractedAt)) {
        extractedAt = record.sources.timecardExtractedAt;
      }

      return {
        date: isoToDdmm(record.date),
        day: record.day,
        isoDate: record.date,
        ...record.current.timecard,
      };
    })
    .sort((left, right) => left.isoDate.localeCompare(right.isoDate));

  if (!extractedAt || entries.length === 0) {
    return null;
  }

  return {
    extractedAt,
    period: options.period ?? "Stored Days",
    entries,
  };
}

/**
 * @param {string} dataDir
 * @param {{ from?: string, to?: string }} [options]
 * @returns {Record<string, {start: string, end: string}[]>}
 */
function buildBreakSegmentsFromStore(dataDir, options = {}) {
  const records = loadDayRecords(dataDir, options);
  const breakSegments = {};

  for (const record of records) {
    const segments = record.current?.schedule?.segments;
    if (Array.isArray(segments) && segments.length > 1) {
      breakSegments[record.date] = segments;
    }
  }

  return breakSegments;
}

/**
 * @param {string} dataDir
 * @returns {string}
 */
function writeDayIndex(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const outputPath = path.join(dataDir, DAY_INDEX_FILE);
  fs.writeFileSync(
    outputPath,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      dates: listStoredDates(dataDir),
    }, null, 2)
  );
  return outputPath;
}

/**
 * @param {string} dataDir
 * @param {"schedule" | "timecard"} prefix
 * @returns {string[]}
 */
function listLegacySnapshotFiles(dataDir, prefix) {
  if (!fs.existsSync(dataDir)) {
    return [];
  }

  return fs.readdirSync(dataDir)
    .filter((name) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(name))
    .sort();
}

/**
 * @param {string} dataDir
 * @returns {Array<{
 *   date: string,
 *   day: string,
 *   current: { schedule: object | null, timecard: object | null },
 *   sources: { scheduleExtractedAt: string | null, timecardExtractedAt: string | null, updatedAt: string | null },
 * }>}
 */
function snapshotCurrentStore(dataDir) {
  return loadDayRecords(dataDir).map((record) => ({
    date: record.date,
    day: record.day,
    current: {
      schedule: record.current?.schedule ?? null,
      timecard: record.current?.timecard ?? null,
    },
    sources: {
      scheduleExtractedAt: record.sources?.scheduleExtractedAt ?? null,
      timecardExtractedAt: record.sources?.timecardExtractedAt ?? null,
      updatedAt: record.sources?.updatedAt ?? null,
    },
  }));
}

/**
 * @param {string} dataDir
 * @returns {{
 *   migratedScheduleFiles: number,
 *   migratedTimecardFiles: number,
 *   migratedDates: number,
 *   backupDaysDir: string | null,
 *   backupIndexPath: string | null,
 * }}
 */
function migrateLegacyData(dataDir) {
  const scheduleFiles = listLegacySnapshotFiles(dataDir, "schedule");
  const timecardFiles = listLegacySnapshotFiles(dataDir, "timecard");
  const existingStore = snapshotCurrentStore(dataDir);
  const tempDataDir = path.join(dataDir, ".migration-store");

  fs.rmSync(tempDataDir, { recursive: true, force: true });
  fs.mkdirSync(tempDataDir, { recursive: true });

  for (const fileName of scheduleFiles) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, fileName), "utf8"));
    if (Array.isArray(parsed.shifts)) {
      persistScheduleData(tempDataDir, parsed);
    }
  }

  for (const fileName of timecardFiles) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, fileName), "utf8"));
    if (Array.isArray(parsed.entries)) {
      persistTimecardData(tempDataDir, parsed);
    }
  }

  for (const record of existingStore) {
    if (record.current.schedule && record.sources.scheduleExtractedAt) {
      persistScheduleData(tempDataDir, {
        extractedAt: record.sources.scheduleExtractedAt,
        shifts: [{
          date: record.date,
          day: record.day,
          ...record.current.schedule,
        }],
      });
    }

    if (record.current.timecard && record.sources.timecardExtractedAt) {
      persistTimecardData(tempDataDir, {
        extractedAt: record.sources.timecardExtractedAt,
        entries: [{
          date: isoToDdmm(record.date),
          day: record.day,
          isoDate: record.date,
          ...record.current.timecard,
        }],
      });
    }
  }

  writeDayIndex(tempDataDir);

  const existingDaysDir = getDaysDir(dataDir);
  const existingIndexPath = path.join(dataDir, DAY_INDEX_FILE);
  const backupSuffix = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDaysDir = fs.existsSync(existingDaysDir)
    ? path.join(dataDir, `days.backup-${backupSuffix}`)
    : null;
  const backupIndexPath = fs.existsSync(existingIndexPath)
    ? path.join(dataDir, `index.backup-${backupSuffix}.json`)
    : null;

  if (backupDaysDir) {
    fs.renameSync(existingDaysDir, backupDaysDir);
  }
  if (backupIndexPath) {
    fs.renameSync(existingIndexPath, backupIndexPath);
  }

  fs.renameSync(getDaysDir(tempDataDir), existingDaysDir);
  fs.renameSync(path.join(tempDataDir, DAY_INDEX_FILE), existingIndexPath);
  fs.rmSync(tempDataDir, { recursive: true, force: true });

  return {
    migratedScheduleFiles: scheduleFiles.length,
    migratedTimecardFiles: timecardFiles.length,
    migratedDates: listStoredDates(dataDir).length,
    backupDaysDir,
    backupIndexPath,
  };
}

export {
  DAY_INDEX_FILE,
  DAYS_DIR_NAME,
  addIsoDays,
  buildBreakSegmentsFromStore,
  buildScheduleDataFromStore,
  buildTimecardDataFromStore,
  getDayFilePath,
  listStoredDates,
  loadDayRecord,
  migrateLegacyData,
  persistScheduleData,
  persistTimecardData,
  resolveDdmmIso,
  writeDayIndex,
};
