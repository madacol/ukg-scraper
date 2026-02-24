import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

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
 * Run the unified scraper and return combined results.
 * @param {{ ukg: { username: string, password: string } }} config
 * @returns {{ schedule: Object | null, timecard: Object | null, errors: string[] }}
 */
function runScrapers(config) {
  const result = execFileSync(
    process.execPath,
    [path.join(__dirname, "scrape-all.js"), config.ukg.username, config.ukg.password],
    { encoding: "utf8", timeout: 300_000, stdio: ["pipe", "pipe", "inherit"] }
  );
  return JSON.parse(result);
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

function loadLatest(name) {
  const p = path.join(DATA_DIR, `${name}-latest.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// --- Formatting helpers ---

/** @type {readonly string[]} */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** @type {Record<string, string>} */
const FIELD_LABELS = {
  clockIn1: "Clock In",
  clockOut1: "Clock Out",
  clockIn2: "Clock In 2",
  clockOut2: "Clock Out 2",
  payCode: "Pay Code",
  amount: "Amount",
  shiftTotal: "Shift Total",
  dailyTotal: "Daily Total",
};

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
 * Format an MM/DD date with its day name as "Fri 20 Feb".
 * @param {string} day - Short day name
 * @param {string} mmdd - Date in MM/DD format
 * @returns {string}
 */
function formatMmdd(day, mmdd) {
  const [mm, dd] = mmdd.split("/").map(Number);
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
  if (s.start && s.end) return `${s.start}–${s.end}`;
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
    if (prev.start !== s.start || prev.end !== s.end || prev.off !== s.off) {
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

  // Timecard dates are MM/DD format — match against today
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  const todayEntry = timecardData.entries.find((e) => e.date === mmdd);
  if (!todayEntry || (!todayEntry.clockIn1 && !todayEntry.clockOut1)) return null;

  const lines = [];
  const THRESHOLD = 50;

  if (todayEntry.clockIn1 && todayShift.start) {
    const diff = Math.abs(parseTime(todayEntry.clockIn1) - parseTime(todayShift.start));
    if (diff > THRESHOLD) {
      lines.push(`  Clock In:  ${todayEntry.clockIn1} (scheduled ${todayShift.start}, ${diff} min off)`);
    }
  }

  if (todayEntry.clockOut1 && todayShift.end) {
    const diff = Math.abs(parseTime(todayEntry.clockOut1) - parseTime(todayShift.end));
    if (diff > THRESHOLD) {
      lines.push(`  Clock Out: ${todayEntry.clockOut1} (scheduled ${todayShift.end}, ${diff} min off)`);
    }
  }

  if (lines.length === 0) return null;

  const label = formatIsoDate(todayShift.day, todayStr);
  return [`${label}\n${lines.join("\n")}`];
}

/**
 * @param {{ entries: Array<Record<string, string | null>> } | null} oldData
 * @param {{ entries: Array<Record<string, string | null>> }} newData
 * @returns {string[] | null}
 */
function detectTimecardChanges(oldData, newData) {
  if (!oldData) return null;

  /** @type {Record<string, Record<string, string | null>>} */
  const oldEntries = {};
  for (const e of oldData.entries) oldEntries[e.date] = e;

  const changes = [];
  for (const e of newData.entries) {
    const label = formatMmdd(e.day, e.date);
    const prev = oldEntries[e.date];
    if (!prev) {
      changes.push(`${label} — New entry`);
      continue;
    }
    const fields = ["clockIn1", "clockOut1", "clockIn2", "clockOut2", "payCode", "amount", "shiftTotal", "dailyTotal"];
    const diffs = [];
    for (const f of fields) {
      if (prev[f] !== e[f]) {
        diffs.push(`  ${FIELD_LABELS[f]}: ${prev[f] ?? "—"} → ${e[f] ?? "—"}`);
      }
    }
    if (diffs.length > 0) {
      changes.push(`${label} — Changed\n${diffs.join("\n")}`);
    }
  }

  return changes.length > 0 ? changes : null;
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
      saveData("schedule", date, scheduleData);
      log(`Schedule saved: data/schedule-${date}.json`);
    }

    if (result.timecard) {
      timecardData = result.timecard;
      saveData("timecard", date, timecardData);
      log(`Timecard saved: data/timecard-${date}.json`);
    }
  } catch (err) {
    log(`Scraper failed: ${err.message}`);
    alerts.push("Scraper FAILED:\n  " + err.message);
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
    const timecardChanges = detectTimecardChanges(prevTimecard, timecardData);
    if (timecardChanges) {
      alerts.push(formatAlert("TIMECARD CHANGES", timecardChanges));
    }
  }

  // Send email if there are alerts
  if (alerts.length > 0) {
    const subjects = [];
    if (alerts.some((a) => a.startsWith("SCHEDULE"))) subjects.push("Schedule changed");
    if (alerts.some((a) => a.startsWith("TIMECARD vs"))) subjects.push("Timecard mismatch");
    if (alerts.some((a) => a.startsWith("TIMECARD CHANGES"))) subjects.push("Timecard changed");
    if (alerts.some((a) => a.includes("FAILED"))) subjects.push("Scraper error");

    const subject = `UKG Alert: ${subjects.join(", ") || "Changes detected"}`;
    const body = `UKG Daily Run — ${date}\n${"=".repeat(40)}\n\n${alerts.join("\n\n")}\n`;

    try {
      await sendEmail(config, subject, body);
    } catch (err) {
      log(`Failed to send email: ${err.message}`);
    }
  } else {
    log("No changes detected. No email sent.");
  }

  log("Done.");
}

export { formatShift, detectScheduleChanges, detectTimecardDiscrepancy, detectTimecardChanges, parseTime, formatAlert };

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
