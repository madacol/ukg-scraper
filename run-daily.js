import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import {
  addIsoDays,
  buildBreakSegmentsFromStore,
  buildScheduleDataFromStore,
  buildTimecardDataFromStore,
  persistScheduleData,
  persistTimecardData,
  writeDayIndex,
} from "./day-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("Missing config.json — copy the template and fill in credentials.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function log(msg) {
  console.error(`[${new Date().toISOString()}] ${msg}`);
}

// --- Scraper runner ---

/**
 * Trim process output down to the last few non-empty lines for readable alerts.
 * @param {string | null | undefined} value
 * @param {number} [maxLines]
 * @returns {string}
 */
function tailOutput(value, maxLines = 20) {
  const lines = (value || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return lines.slice(-maxLines).join("\n");
}

/**
 * Normalize the scraper child-process result.
 * Accepts structured JSON from stdout even when the process exits nonzero.
 * @param {{ status: number | null, signal?: NodeJS.Signals | null, stdout?: string | null, stderr?: string | null, error?: Error }} result
 * @returns {{ schedule: Object | null, timecard: Object | null, errors: string[] }}
 */
function parseScraperResult(result) {
  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const trimmedStdout = stdout.trim();

  if (trimmedStdout) {
    try {
      const parsed = JSON.parse(trimmedStdout);
      return {
        schedule: parsed.schedule ?? null,
        timecard: parsed.timecard ?? null,
        errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      };
    } catch {
      // Fall through to the unstructured error path below.
    }
  }

  const statusInfo = result.signal
    ? `signal ${result.signal}`
    : `exit code ${result.status ?? "unknown"}`;
  const details = tailOutput(stderr) || tailOutput(stdout) || "No output from scraper process";
  throw new Error(`Scraper process failed (${statusInfo})\n${details}`);
}

/**
 * Run the unified scraper and return combined results.
 * @param {{ ukg: { username: string, password: string } }} config
 * @returns {{ schedule: Object | null, timecard: Object | null, errors: string[] }}
 */
function runScrapers(config) {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "scrape-all.js"), config.ukg.username, config.ukg.password],
    { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] }
  );
  return parseScraperResult(result);
}

/**
 * Merge schedule segment data into an existing break-segments map.
 * @param {Record<string, {start: string, end: string}[]>} cache
 * @param {{ shifts: Array<{ date: string, segments: {start: string, end: string}[] }> }} scheduleData
 * @returns {Record<string, {start: string, end: string}[]>}
 */
function mergeBreakSegments(cache, scheduleData) {
  const merged = { ...cache };
  for (const shift of scheduleData.shifts) {
    if (shift.segments && shift.segments.length > 1) {
      merged[shift.date] = shift.segments;
    }
  }
  return merged;
}

// --- Formatting helpers ---

/** @type {readonly string[]} */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** @type {Record<string, string>} */
const FIELD_LABELS = {
  payCode: "Pay Code",
  amount: "Amount",
};

/**
 * Format clock in/out pairs as "9:00 - 17:00" or "13:56 - 16:36, 16:51 - 19:26".
 * Returns null if there are no clock pairs.
 * @param {Record<string, string | null | undefined>} entry
 * @returns {string | null}
 */
function formatClockPairs(entry) {
  const pairs = [];
  for (let i = 1; ; i += 1) {
    const clockIn = entry[`clockIn${i}`];
    const clockOut = entry[`clockOut${i}`];
    if (!clockIn && !clockOut) {
      if (i > 10) break;
      continue;
    }
    if (clockIn) {
      pairs.push(`${clockIn} - ${clockOut ?? "?"}`);
    }
  }
  return pairs.length > 0 ? pairs.join(", ") : null;
}

/**
 * Calculate daily total from clock in/out pairs in H:MM format.
 * When `hasScheduledBreak` is true and the entry has a split shift (two clock pairs),
 * adds 5 minutes to match UKG's paid break bonus.
 * Returns null if there are no complete pairs.
 * @param {Record<string, string | null | undefined>} entry
 * @param {boolean} [hasScheduledBreak]
 * @returns {string | null}
 */
function calculateDailyTotal(entry, hasScheduledBreak) {
  let totalMinutes = 0;
  let completePairs = 0;
  for (let i = 1; i <= 10; i += 1) {
    const clockIn = parseTime(entry[`clockIn${i}`]);
    const clockOut = parseTime(entry[`clockOut${i}`]);
    if (clockIn !== null && clockOut !== null) {
      totalMinutes += clockOut - clockIn;
      completePairs += 1;
    }
  }
  if (totalMinutes <= 0) return null;
  if (hasScheduledBreak && completePairs > 1) {
    totalMinutes += 5; // UKG adds a 5-minute paid break bonus
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${String(mins).padStart(2, "0")}`;
}

/**
 * Format an ISO date (YYYY-MM-DD) with its day name as "Fri 20 Feb".
 * @param {string} day - Short day name
 * @param {string} isoDate - ISO date string
 * @returns {string}
 */
function formatIsoDate(day, isoDate) {
  const mm = parseInt(isoDate.slice(5, 7));
  const dd = parseInt(isoDate.slice(8));
  return `${day} ${dd} ${MONTHS[mm - 1]}`;
}

/**
 * Format a DD/MM date with its day name as "Fri 20 Feb".
 * @param {string} day - Short day name
 * @param {string} ddmm - Date in DD/MM format
 * @returns {string}
 */
function formatDdmm(day, ddmm) {
  const [dd, mm] = ddmm.split("/").map(Number);
  return `${day} ${dd} ${MONTHS[mm - 1]}`;
}

/**
 * Format a section header with title and divider.
 * @param {string} title
 * @param {string[]} items
 * @returns {string}
 */
function formatAlert(title, items) {
  return `${title}\n${"-".repeat(title.length)}\n${items.join("\n\n")}`;
}

/**
 * Keep only alert items that are new or textually changed compared with the
 * previous run.
 * @param {string[] | null | undefined} currentItems
 * @param {string[] | null | undefined} previousItems
 * @returns {string[] | null}
 */
function filterNewOrChangedItems(currentItems, previousItems) {
  if (!currentItems || currentItems.length === 0) return null;
  if (!previousItems || previousItems.length === 0) return currentItems;

  const previousSet = new Set(previousItems);
  const filtered = currentItems.filter((item) => !previousSet.has(item));
  return filtered.length > 0 ? filtered : null;
}

// --- Change detection ---

/**
 * @param {{ off: boolean, note?: string | null, start?: string | null, end?: string | null }} s
 * @returns {string}
 */
function formatShift(s) {
  if (s.off) return s.note || "Day Off";
  if (s.start && s.end) {
    let text = `${s.start}–${s.end}`;
    if (s.segments && s.segments.length > 1) {
      const breakStart = s.segments[0].end;
      const breakEnd = s.segments[1].start;
      text += ` (break ${breakStart}–${breakEnd})`;
    }
    return text;
  }
  if (s.note) return s.note;
  return "No details";
}

/**
 * @param {{ shifts: Array<{ date: string, day: string, start: string | null, end: string | null, off: boolean, note?: string | null }> } | null} oldData
 * @param {{ shifts: Array<{ date: string, day: string, start: string | null, end: string | null, off: boolean, note?: string | null }> }} newData
 * @returns {string[] | null}
 */
function detectScheduleChanges(oldData, newData) {
  if (!oldData) return null;

  const oldShifts = {};
  for (const s of oldData.shifts) oldShifts[s.date] = s;

  const changes = [];
  for (const s of newData.shifts) {
    const label = formatIsoDate(s.day, s.date);
    const prev = oldShifts[s.date];
    if (!prev) {
      changes.push(`${label} — New\n  ${formatShift(s)}`);
      continue;
    }
    const prevSegs = prev.segments;
    const newSegs = s.segments;
    const segmentsChanged = prevSegs && newSegs
      ? JSON.stringify(prevSegs) !== JSON.stringify(newSegs)
      : false;
    if (prev.start !== s.start || prev.end !== s.end || prev.off !== s.off || segmentsChanged) {
      changes.push(`${label} — Changed\n  Was: ${formatShift(prev)}\n  Now: ${formatShift(s)}`);
    }
  }

  return changes.length > 0 ? changes : null;
}

/**
 * @param {string | null | undefined} str
 * @returns {number | null}
 */
function parseTime(str) {
  if (!str) return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

/**
 * @param {string} isoDate
 * @returns {string}
 */
function isoToDdmm(isoDate) {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
}

/**
 * @param {Record<string, string | null | undefined> | undefined} entry
 * @returns {boolean}
 */
function hasTimecardActivity(entry) {
  if (!entry) return false;
  for (let i = 1; i <= 10; i += 1) {
    if (entry[`clockIn${i}`] || entry[`clockOut${i}`]) return true;
  }
  return Boolean(
    entry.absence ||
    entry.payCode ||
    entry.amount ||
    entry.shiftTotal ||
    entry.dailyTotal
  );
}

/**
 * @param {Record<string, string | null | undefined>} entry
 * @returns {boolean}
 */
function hasCompleteClockPair(entry) {
  for (let i = 1; i <= 10; i += 1) {
    if (entry[`clockIn${i}`] && entry[`clockOut${i}`]) return true;
  }
  return false;
}

/**
 * @param {Record<string, string | null | undefined>} entry
 * @returns {boolean}
 */
function hasClockOut(entry) {
  for (let i = 1; i <= 10; i += 1) {
    if (entry[`clockOut${i}`]) return true;
  }
  return false;
}

/**
 * A new current-day timecard with only an on-time clock-in is expected while
 * the shift is still in progress, so it should not generate a change alert.
 * @param {Record<string, string | null | undefined>} entry
 * @param {{ date?: string, start: string | null, end: string | null, off: boolean } | undefined} shift
 * @param {Date} now
 * @param {number} thresholdMinutes
 * @returns {boolean}
 */
function isExpectedInProgressTimecard(entry, shift, now, thresholdMinutes) {
  if (!shift || shift.off || !shift.date || !shift.start || !shift.end) return false;
  if (shift.date !== now.toISOString().slice(0, 10)) return false;
  if (!entry.clockIn1 || hasClockOut(entry) || hasCompleteClockPair(entry)) return false;
  if (entry.absence || entry.payCode || entry.amount || entry.shiftTotal || entry.dailyTotal) return false;

  const clockIn = parseTime(entry.clockIn1);
  const scheduledStart = parseTime(shift.start);
  const scheduledEnd = parseTime(shift.end);
  if (clockIn === null || scheduledStart === null || scheduledEnd === null) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return Math.abs(clockIn - scheduledStart) <= thresholdMinutes
    && nowMinutes <= scheduledEnd + thresholdMinutes;
}

/**
 * @param {{ shifts: Array<{ date: string, day: string, start: string | null, end: string | null, off: boolean }> } | null} scheduleData
 * @param {{ entries: Array<{ date: string, day: string, clockIn1?: string | null, clockOut1?: string | null }> } | null} timecardData
 * @param {string} [dateOverride]
 * @param {string | Date} [nowOverride]
 * @returns {string[] | null}
 */
function detectTimecardDiscrepancy(scheduleData, timecardData, dateOverride, nowOverride) {
  if (!scheduleData || !timecardData) return null;

  const now = nowOverride instanceof Date ? nowOverride : (nowOverride ? new Date(nowOverride) : new Date());
  const d = dateOverride ? new Date(dateOverride + "T00:00:00") : now;
  const todayStr = d.toISOString().slice(0, 10);
  const todayShift = scheduleData.shifts.find((s) => s.date === todayStr && !s.off);
  if (!todayShift) return null;

  // Timecard dates are DD/MM format — match against today
  const ddmm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const todayEntry = timecardData.entries.find((e) => e.date === ddmm);

  const lines = [];
  const THRESHOLD = 50;
  const nowIso = now.toISOString().slice(0, 10);
  let finalClockOut = null;
  if (todayEntry) {
    for (let i = 1; i <= 10; i += 1) {
      finalClockOut = todayEntry[`clockOut${i}`] || finalClockOut;
    }
  }

  if (!todayEntry?.clockIn1 && todayShift.start && todayStr === nowIso) {
    const scheduledStart = parseTime(todayShift.start);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (scheduledStart !== null) {
      const diff = nowMinutes - scheduledStart;
      if (diff > THRESHOLD) {
        lines.push(`  Clock In:  missing (scheduled ${todayShift.start}, ${diff} min late)`);
      }
    }
  }

  if (todayEntry?.clockIn1 && todayShift.start) {
    const diff = Math.abs(parseTime(todayEntry.clockIn1) - parseTime(todayShift.start));
    if (diff > THRESHOLD) {
      lines.push(`  Clock In:  ${todayEntry.clockIn1} (scheduled ${todayShift.start}, ${diff} min off)`);
    }
  }

  if (finalClockOut && todayShift.end) {
    const diff = Math.abs(parseTime(finalClockOut) - parseTime(todayShift.end));
    if (diff > THRESHOLD) {
      lines.push(`  Clock Out: ${finalClockOut} (scheduled ${todayShift.end}, ${diff} min off)`);
    }
  }

  if (lines.length === 0) return null;

  const label = formatIsoDate(todayShift.day, todayStr);
  return [`${label}\n${lines.join("\n")}`];
}

/**
 * @param {{ entries: Array<Record<string, string | null>> } | null} oldData
 * @param {{ entries: Array<Record<string, string | null>> }} newData
 * @param {{ shifts: Array<{ date: string, day: string, start: string | null, end: string | null, off: boolean }> }} [scheduleData]
 * @param {string | Date} [nowOverride]
 * @returns {string[] | null}
 */
function detectTimecardChanges(oldData, newData, scheduleData, nowOverride) {
  if (!oldData) return null;

  const now = nowOverride instanceof Date ? nowOverride : (nowOverride ? new Date(nowOverride) : new Date());

  /** @type {Record<string, Record<string, string | null>>} */
  const oldEntries = {};
  for (const e of oldData.entries) oldEntries[e.date] = e;

  // Build DD/MM → shift lookup from schedule data
  /** @type {Record<string, { date: string, start: string | null, end: string | null, off: boolean }>} */
  const shiftByDdmm = {};
  if (scheduleData) {
    for (const s of scheduleData.shifts) {
      const mm = s.date.slice(5, 7);
      const dd = s.date.slice(8);
      shiftByDdmm[`${dd}/${mm}`] = s;
    }
  }

  const THRESHOLD = 50;
  const changes = [];
  for (const e of newData.entries) {
    const label = formatDdmm(e.day, e.date);
    const prev = oldEntries[e.date];

    if (!prev) {
      const lines = [];
      const pairs = formatClockPairs(e);
      if (pairs) lines.push(`  ${pairs}`);
      if (e.payCode) lines.push(`  Pay Code: ${e.payCode}`);
      if (e.dailyTotal) lines.push(`  Daily Total: ${e.dailyTotal}`);
      if (lines.length > 0) {
        const shift = shiftByDdmm[e.date];
        if (scheduleData) {
          const hasCompletePair = hasCompleteClockPair(e);
          const isOff = !shift || shift.off;
          if (isOff && !hasCompletePair) continue;
          if (isExpectedInProgressTimecard(e, shift, now, THRESHOLD)) continue;
          if (shift && !shift.off && shift.start && shift.end) {
            const inDiff = parseTime(e.clockIn1) !== null && parseTime(shift.start) !== null
              ? Math.abs(parseTime(e.clockIn1) - parseTime(shift.start))
              : Infinity;
            const outDiff = parseTime(e.clockOut1) !== null && parseTime(shift.end) !== null
              ? Math.abs(parseTime(e.clockOut1) - parseTime(shift.end))
              : Infinity;
            if (inDiff <= THRESHOLD && outDiff <= THRESHOLD) continue;
          }
        }
        changes.push(`${label} — New\n${lines.join("\n")}`);
      }
      continue;
    }

    const lines = [];
    let clockChanged = false;
    for (let i = 1; i <= 10; i += 1) {
      clockChanged ||= prev[`clockIn${i}`] !== e[`clockIn${i}`] || prev[`clockOut${i}`] !== e[`clockOut${i}`];
    }
    if (clockChanged) {
      const oldPairs = formatClockPairs(prev);
      const newPairs = formatClockPairs(e);
      if (oldPairs || newPairs) {
        lines.push(`  Was: ${oldPairs ?? "—"}`);
        lines.push(`  Now: ${newPairs ?? "—"}`);
      }
    }
    for (const f of ["payCode", "amount"]) {
      if (prev[f] !== e[f]) {
        lines.push(`  ${FIELD_LABELS[f]}: ${prev[f] ?? "—"} → ${e[f] ?? "—"}`);
      }
    }
    if (prev.dailyTotal !== e.dailyTotal) {
      lines.push(`  Daily Total: ${prev.dailyTotal ?? "—"} → ${e.dailyTotal ?? "—"}`);
    }
    if (lines.length > 0) {
      changes.push(`${label} — Changed\n${lines.join("\n")}`);
    }
  }

  return changes.length > 0 ? changes : null;
}

/**
 * Detect scheduled past days that have no matching timecard activity.
 * @param {{ shifts: Array<{ date: string, day: string, start: string | null, end: string | null, off: boolean, note?: string | null }> } | null} scheduleData
 * @param {{ entries: Array<Record<string, string | null | undefined>> } | null} timecardData
 * @param {string} [todayIso]
 * @returns {string[] | null}
 */
function detectMissingTimecardEntries(scheduleData, timecardData, todayIso) {
  if (!scheduleData || !timecardData) return null;

  const cutoffIso = todayIso ?? new Date().toISOString().slice(0, 10);
  const entryByDdmm = {};
  for (const entry of timecardData.entries) {
    if (typeof entry.date === "string") {
      entryByDdmm[entry.date] = entry;
    }
  }

  const missing = [];
  for (const shift of scheduleData.shifts) {
    if (shift.off || shift.date >= cutoffIso) {
      continue;
    }

    const entry = entryByDdmm[isoToDdmm(shift.date)];
    if (hasTimecardActivity(entry)) {
      continue;
    }

    const label = formatIsoDate(shift.day, shift.date);
    missing.push(`${label}\n  Scheduled: ${formatShift(shift)}\n  Timecard: missing`);
  }

  return missing.length > 0 ? missing : null;
}

/**
 * Detect mismatches between calculated daily total (from clock pairs)
 * and the scraped daily total reported by UKG.
 * Accept either the raw clock total or the break-adjusted total, and ignore
 * 1-minute drift to avoid noisy alerts from UKG rounding/edit metadata.
 * @param {{ entries: Array<Record<string, string | null>> } | null} timecardData
 * @param {Record<string, {start: string, end: string}[]>} [breakCache] - date → segments for dates with scheduled breaks
 * @returns {string[] | null}
 */
function detectTotalMismatch(timecardData, breakCache) {
  if (!timecardData) return null;

  const mismatches = [];
  const TOLERANCE_MINUTES = 1;
  for (const e of timecardData.entries) {
    // Convert DD/MM to YYYY-MM-DD for cache lookup (assume current year)
    const [dd, mm] = (e.date || "").split("/");
    const year = new Date().getFullYear();
    const isoDate = dd && mm ? `${year}-${mm}-${dd}` : "";
    const hasScheduledBreak = !!(breakCache && breakCache[isoDate]);
    const rawTotal = calculateDailyTotal(e);
    const adjustedTotal = hasScheduledBreak ? calculateDailyTotal(e, true) : rawTotal;
    if (!rawTotal || !e.dailyTotal) continue;

    const reportedMinutes = parseTime(e.dailyTotal);
    const rawMinutes = parseTime(rawTotal);
    const adjustedMinutes = adjustedTotal ? parseTime(adjustedTotal) : null;
    if (reportedMinutes === null || rawMinutes === null) continue;

    const rawDiff = Math.abs(rawMinutes - reportedMinutes);
    const adjustedDiff = adjustedMinutes === null ? rawDiff : Math.abs(adjustedMinutes - reportedMinutes);
    if (Math.min(rawDiff, adjustedDiff) <= TOLERANCE_MINUTES) {
      continue;
    }

    const calculated = adjustedDiff < rawDiff && adjustedTotal ? adjustedTotal : rawTotal;
    if (calculated !== e.dailyTotal) {
      const label = formatDdmm(e.day, e.date);
      mismatches.push(`${label}\n  ${formatClockPairs(e)}\n  Calculated: ${calculated}\n  Reported:   ${e.dailyTotal}`);
    }
  }

  return mismatches.length > 0 ? mismatches : null;
}

// --- Email ---

async function sendEmail(config, subject, body) {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    auth: {
      user: config.email.from,
      pass: config.email.gmailAppPassword,
    },
  });

  await transport.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject,
    text: body,
  });

  log(`Email sent: ${subject}`);
}

// --- Main ---

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log("DRY RUN — no files saved, no email sent");

  const config = loadConfig();
  const date = today();
  const alerts = [];

  // Load previous data before overwriting
  const prevSchedule = buildScheduleDataFromStore(DATA_DIR);
  const prevTimecard = buildTimecardDataFromStore(DATA_DIR);
  const prevBreakCache = prevSchedule ? mergeBreakSegments({}, prevSchedule) : {};

  // Run unified scraper (single login, parallel scrapes)
  log("Running scrapers...");
  let scheduleData;
  let timecardData;
  let storeChanged = false;
  try {
    const result = runScrapers(config);

    for (const err of result.errors) {
      log(err);
      alerts.push(err);
    }

    if (result.schedule) {
      scheduleData = result.schedule;
      if (!dryRun) {
        const persisted = persistScheduleData(DATA_DIR, scheduleData);
        log(`Schedule stored: ${persisted.changedDates.length} day(s) updated`);
        storeChanged = true;
      }
    }

    if (result.timecard) {
      timecardData = result.timecard;
      if (!dryRun) {
        const persisted = persistTimecardData(DATA_DIR, timecardData);
        log(`Timecard stored: ${persisted.changedDates.length} day(s) updated`);
        storeChanged = true;
      }
    }

    if (!dryRun && storeChanged) {
      const indexPath = writeDayIndex(DATA_DIR);
      log(`Day index saved: ${path.relative(__dirname, indexPath)}`);
    }
  } catch (err) {
    log(`Scraper failed: ${err.message}`);
    alerts.push("Scraper FAILED:\n  " + err.message);
  }

  // Build break segments from stored day files and merge in the current scrape
  const breakWindowStart = addIsoDays(date, -30);
  let breakCache = buildBreakSegmentsFromStore(DATA_DIR, { from: breakWindowStart, to: date });
  if (scheduleData) {
    breakCache = mergeBreakSegments(breakCache, scheduleData);
  }

  // Detect changes
  if (scheduleData) {
    const scheduleChanges = detectScheduleChanges(prevSchedule, scheduleData);
    if (scheduleChanges) {
      alerts.push(formatAlert("SCHEDULE CHANGES", scheduleChanges));
    }
  }

  if (timecardData && scheduleData) {
    const discrepancy = detectTimecardDiscrepancy(scheduleData, timecardData);
    if (discrepancy) {
      alerts.push(formatAlert("TIMECARD vs SCHEDULE MISMATCH", discrepancy));
    }
  }

  if (timecardData) {
    const timecardChanges = detectTimecardChanges(prevTimecard, timecardData, scheduleData);
    if (timecardChanges) {
      alerts.push(formatAlert("TIMECARD CHANGES", timecardChanges));
    }

    const missingTimecard = detectMissingTimecardEntries(scheduleData, timecardData, date);
    if (missingTimecard) {
      alerts.push(formatAlert("TIMECARD MISSING", missingTimecard));
    }

    const totalMismatch = filterNewOrChangedItems(
      detectTotalMismatch(timecardData, breakCache),
      detectTotalMismatch(prevTimecard, prevBreakCache)
    );
    if (totalMismatch) {
      alerts.push(formatAlert("TIMECARD TOTAL MISMATCH", totalMismatch));
    }
  }

  // Send email if there are alerts
  if (alerts.length > 0) {
    const subjects = [];
    if (alerts.some((a) => a.startsWith("SCHEDULE"))) subjects.push("Schedule changed");
    if (alerts.some((a) => a.startsWith("TIMECARD vs"))) subjects.push("Timecard mismatch");
    if (alerts.some((a) => a.startsWith("TIMECARD CHANGES"))) subjects.push("Timecard changed");
    if (alerts.some((a) => a.startsWith("TIMECARD MISSING"))) subjects.push("Timecard missing");
    if (alerts.some((a) => a.startsWith("TIMECARD TOTAL"))) subjects.push("Total mismatch");
    if (alerts.some((a) => a.includes("FAILED"))) subjects.push("Scraper error");

    const subject = `UKG Alert: ${subjects.join(", ") || "Changes detected"}`;
    const body = `UKG Daily Run — ${date}\n${"=".repeat(40)}\n\n${alerts.join("\n\n")}\n`;

    log(`--- EMAIL PREVIEW ---\nSubject: ${subject}\n\n${body}--- END PREVIEW ---`);

    if (dryRun) {
      log("DRY RUN — email not sent");
    } else {
      try {
        await sendEmail(config, subject, body);
      } catch (err) {
        log(`Failed to send email: ${err.message}`);
      }
    }
  } else {
    log("No changes detected. No email sent.");
  }

  log("Done.");
}

export {
  formatShift, detectScheduleChanges, detectTimecardDiscrepancy, detectTimecardChanges,
  parseTime, formatAlert, calculateDailyTotal, formatClockPairs, detectTotalMismatch,
  detectMissingTimecardEntries, filterNewOrChangedItems,
  parseScraperResult, tailOutput,
};

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
