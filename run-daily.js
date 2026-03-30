import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import { buildWebsiteTimecardData, saveWebsiteTimecardData } from "./website-data.js";

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

function saveData(name, date, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const dated = path.join(DATA_DIR, `${name}-${date}.json`);
  const latest = path.join(DATA_DIR, `${name}-latest.json`);
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(dated, json);
  fs.writeFileSync(latest, json);
  return dated;
}

function refreshWebsiteTimecard(date) {
  const websiteTimecard = buildWebsiteTimecardData({
    dataDir: DATA_DIR,
    todayIso: date,
    windowDays: 30,
  });

  if (!websiteTimecard) {
    return null;
  }

  return saveWebsiteTimecardData(DATA_DIR, websiteTimecard);
}

function loadLatest(name) {
  const p = path.join(DATA_DIR, `${name}-latest.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const BREAKS_PATH = path.join(DATA_DIR, "break-segments.json");

/**
 * Load the persistent break-segments cache (date → segments).
 * @returns {Record<string, {start: string, end: string}[]>}
 */
function loadBreakSegments() {
  if (!fs.existsSync(BREAKS_PATH)) return {};
  return JSON.parse(fs.readFileSync(BREAKS_PATH, "utf8"));
}

/**
 * Merge schedule segment data into the break-segments cache.
 * Only stores dates that have >1 segment (i.e. a scheduled break).
 * Prunes entries older than 30 days.
 * @param {{ shifts: Array<{ date: string, segments: {start: string, end: string}[] }> }} scheduleData
 * @param {boolean} persist - Whether to write to disk
 * @returns {Record<string, {start: string, end: string}[]>}
 */
function updateBreakSegments(scheduleData, persist) {
  const cache = loadBreakSegments();
  for (const s of scheduleData.shifts) {
    if (s.segments && s.segments.length > 1) {
      cache[s.date] = s.segments;
    }
  }
  // Prune entries older than 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const date of Object.keys(cache)) {
    if (date < cutoffStr) delete cache[date];
  }
  if (persist) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BREAKS_PATH, JSON.stringify(cache, null, 2));
  }
  return cache;
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
  if (entry.clockIn1) {
    pairs.push(`${entry.clockIn1} - ${entry.clockOut1 ?? "?"}`);
  }
  if (entry.clockIn2) {
    pairs.push(`${entry.clockIn2} - ${entry.clockOut2 ?? "?"}`);
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
  const in1 = parseTime(entry.clockIn1);
  const out1 = parseTime(entry.clockOut1);
  if (in1 !== null && out1 !== null) {
    totalMinutes += out1 - in1;
  }
  const in2 = parseTime(entry.clockIn2);
  const out2 = parseTime(entry.clockOut2);
  if (in2 !== null && out2 !== null) {
    totalMinutes += out2 - in2;
  }
  if (totalMinutes <= 0) return null;
  if (hasScheduledBreak && in2 !== null && out2 !== null) {
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
 * @param {{ shifts: Array<{ date: string, day: string, start: string | null, end: string | null, off: boolean }> } | null} scheduleData
 * @param {{ entries: Array<{ date: string, day: string, clockIn1?: string | null, clockOut1?: string | null }> } | null} timecardData
 * @param {string} [dateOverride]
 * @returns {string[] | null}
 */
function detectTimecardDiscrepancy(scheduleData, timecardData, dateOverride) {
  if (!scheduleData || !timecardData) return null;

  const d = dateOverride ? new Date(dateOverride + "T00:00:00") : new Date();
  const todayStr = d.toISOString().slice(0, 10);
  const todayShift = scheduleData.shifts.find((s) => s.date === todayStr && !s.off);
  if (!todayShift) return null;

  // Timecard dates are DD/MM format — match against today
  const ddmm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const todayEntry = timecardData.entries.find((e) => e.date === ddmm);
  if (!todayEntry || (!todayEntry.clockIn1 && !todayEntry.clockOut1)) return null;

  const lines = [];
  const THRESHOLD = 50;
  const segments = todayShift.segments || [{ start: todayShift.start, end: todayShift.end }];

  /** @type {Array<{ inKey: string, outKey: string, label: string, segment: { start: string | null, end: string | null } }>} */
  const pairs = [
    { inKey: "clockIn1", outKey: "clockOut1", label: "", segment: segments[0] },
    { inKey: "clockIn2", outKey: "clockOut2", label: "2", segment: segments[1] || segments[0] },
  ];

  for (const { inKey, outKey, label, segment } of pairs) {
    if (todayEntry[inKey] && segment.start) {
      const diff = Math.abs(parseTime(todayEntry[inKey]) - parseTime(segment.start));
      if (diff > THRESHOLD) {
        lines.push(`  Clock In${label}:  ${todayEntry[inKey]} (scheduled ${segment.start}, ${diff} min off)`);
      }
    }
    if (todayEntry[outKey] && segment.end) {
      const diff = Math.abs(parseTime(todayEntry[outKey]) - parseTime(segment.end));
      if (diff > THRESHOLD) {
        lines.push(`  Clock Out${label}: ${todayEntry[outKey]} (scheduled ${segment.end}, ${diff} min off)`);
      }
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
 * @returns {string[] | null}
 */
function detectTimecardChanges(oldData, newData, scheduleData) {
  if (!oldData) return null;

  /** @type {Record<string, Record<string, string | null>>} */
  const oldEntries = {};
  for (const e of oldData.entries) oldEntries[e.date] = e;

  // Build DD/MM → shift lookup from schedule data
  /** @type {Record<string, { start: string | null, end: string | null, off: boolean }>} */
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
          const hasCompletePair = (e.clockIn1 && e.clockOut1) || (e.clockIn2 && e.clockOut2);
          const isOff = !shift || shift.off;
          if (isOff && !hasCompletePair) continue;
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
    const clockChanged = prev.clockIn1 !== e.clockIn1 || prev.clockOut1 !== e.clockOut1 ||
                          prev.clockIn2 !== e.clockIn2 || prev.clockOut2 !== e.clockOut2;
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
  const prevSchedule = loadLatest("schedule");
  const prevTimecard = loadLatest("timecard");

  // Run unified scraper (single login, parallel scrapes)
  log("Running scrapers...");
  let scheduleData;
  let timecardData;
  try {
    const result = runScrapers(config);

    for (const err of result.errors) {
      log(err);
      alerts.push(err);
    }

    if (result.schedule) {
      scheduleData = result.schedule;
      if (!dryRun) {
        saveData("schedule", date, scheduleData);
        log(`Schedule saved: data/schedule-${date}.json`);
      }
    }

    if (result.timecard) {
      timecardData = result.timecard;
      if (!dryRun) {
        saveData("timecard", date, timecardData);
        log(`Timecard saved: data/timecard-${date}.json`);
        const websitePath = refreshWebsiteTimecard(date);
        if (websitePath) {
          log(`Website timecard saved: ${path.relative(__dirname, websitePath)}`);
        }
      }
    }
  } catch (err) {
    log(`Scraper failed: ${err.message}`);
    alerts.push("Scraper FAILED:\n  " + err.message);
  }

  // Update break-segments cache with current schedule
  let breakCache = loadBreakSegments();
  if (scheduleData) {
    breakCache = updateBreakSegments(scheduleData, !dryRun);
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

    const totalMismatch = detectTotalMismatch(timecardData, breakCache);
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
  parseScraperResult, tailOutput,
};

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
