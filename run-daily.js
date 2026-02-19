const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

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

// --- Scraper runners ---

function runScraper(script, config) {
  const result = execFileSync(
    process.execPath,
    [path.join(__dirname, script), config.ukg.username, config.ukg.password],
    { encoding: "utf8", timeout: 60_000, stdio: ["pipe", "pipe", "inherit"] }
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

// --- Change detection ---

function detectScheduleChanges(oldData, newData) {
  if (!oldData) return null;

  const oldShifts = {};
  for (const s of oldData.shifts) oldShifts[s.date] = s;

  const changes = [];
  for (const s of newData.shifts) {
    const prev = oldShifts[s.date];
    if (!prev) {
      changes.push(`  NEW: ${s.date} (${s.day}) — ${s.off ? s.note : `${s.start}–${s.end}`}`);
      continue;
    }
    if (prev.start !== s.start || prev.end !== s.end || prev.off !== s.off) {
      const was = prev.off ? prev.note || "Day Off" : `${prev.start}–${prev.end}`;
      const now = s.off ? s.note || "Day Off" : `${s.start}–${s.end}`;
      changes.push(`  CHANGED: ${s.date} (${s.day}): ${was} → ${now}`);
    }
  }

  return changes.length > 0 ? changes : null;
}

function parseTime(str) {
  if (!str) return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function detectTimecardDiscrepancy(scheduleData, timecardData) {
  if (!scheduleData || !timecardData) return null;

  const todayStr = today();
  const todayShift = scheduleData.shifts.find((s) => s.date === todayStr && !s.off);
  if (!todayShift) return null;

  // Timecard dates are MM/DD format — match against today
  const d = new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  const todayEntry = timecardData.entries.find((e) => e.date === mmdd);
  if (!todayEntry || (!todayEntry.clockIn1 && !todayEntry.clockOut1)) return null;

  const issues = [];
  const THRESHOLD = 50;

  if (todayEntry.clockIn1 && todayShift.start) {
    const diff = Math.abs(parseTime(todayEntry.clockIn1) - parseTime(todayShift.start));
    if (diff > THRESHOLD) {
      issues.push(`  Clock-in ${todayEntry.clockIn1} vs scheduled ${todayShift.start} (${diff} min difference)`);
    }
  }

  if (todayEntry.clockOut1 && todayShift.end) {
    const diff = Math.abs(parseTime(todayEntry.clockOut1) - parseTime(todayShift.end));
    if (diff > THRESHOLD) {
      issues.push(`  Clock-out ${todayEntry.clockOut1} vs scheduled ${todayShift.end} (${diff} min difference)`);
    }
  }

  return issues.length > 0 ? issues : null;
}

function detectTimecardChanges(oldData, newData) {
  if (!oldData) return null;

  const oldEntries = {};
  for (const e of oldData.entries) oldEntries[e.date] = e;

  const changes = [];
  for (const e of newData.entries) {
    const prev = oldEntries[e.date];
    if (!prev) {
      changes.push(`  NEW: ${e.date} (${e.day})`);
      continue;
    }
    const fields = ["clockIn1", "clockOut1", "clockIn2", "clockOut2", "payCode", "amount", "shiftTotal", "dailyTotal"];
    const diffs = [];
    for (const f of fields) {
      if (prev[f] !== e[f]) diffs.push(`${f}: ${prev[f] ?? "—"} → ${e[f] ?? "—"}`);
    }
    if (diffs.length > 0) {
      changes.push(`  CHANGED: ${e.date} (${e.day}): ${diffs.join(", ")}`);
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

  // Run scrapers
  log("Running schedule scraper...");
  let scheduleData;
  try {
    scheduleData = runScraper("scrape-schedule.js", config);
    saveData("schedule", date, scheduleData);
    log(`Schedule saved: data/schedule-${date}.json`);
  } catch (err) {
    log(`Schedule scraper failed: ${err.message}`);
    alerts.push("Schedule scraper FAILED:\n  " + err.message);
  }

  log("Running timecard scraper...");
  let timecardData;
  try {
    timecardData = runScraper("scrape-timecard.js", config);
    saveData("timecard", date, timecardData);
    log(`Timecard saved: data/timecard-${date}.json`);
  } catch (err) {
    log(`Timecard scraper failed: ${err.message}`);
    alerts.push("Timecard scraper FAILED:\n  " + err.message);
  }

  // Detect changes
  if (scheduleData) {
    const scheduleChanges = detectScheduleChanges(prevSchedule, scheduleData);
    if (scheduleChanges) {
      alerts.push("Schedule changes detected:\n" + scheduleChanges.join("\n"));
    }
  }

  if (timecardData && scheduleData) {
    const discrepancy = detectTimecardDiscrepancy(scheduleData, timecardData);
    if (discrepancy) {
      alerts.push("Timecard vs schedule discrepancy (>50 min):\n" + discrepancy.join("\n"));
    }
  }

  if (timecardData) {
    const timecardChanges = detectTimecardChanges(prevTimecard, timecardData);
    if (timecardChanges) {
      alerts.push("Timecard changes detected:\n" + timecardChanges.join("\n"));
    }
  }

  // Send email if there are alerts
  if (alerts.length > 0) {
    const subjects = [];
    if (alerts.some((a) => a.includes("Schedule change"))) subjects.push("Schedule changed");
    if (alerts.some((a) => a.includes("discrepancy"))) subjects.push("Timecard discrepancy");
    if (alerts.some((a) => a.includes("Timecard change"))) subjects.push("Timecard changed");
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

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
