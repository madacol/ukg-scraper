import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatDate, addDays, mapApiToShifts } from "./schedule-utils.js";

/** @typedef {import("./schedule-utils.js").Shift} Shift */

/**
 * @typedef {Object} TimecardEntry
 * @property {string} date
 * @property {string} day
 * @property {string | null} schedule
 * @property {string | null} absence
 * @property {string | null} clockIn1
 * @property {string | null} clockOut1
 * @property {string | null} clockIn2
 * @property {string | null} clockOut2
 * @property {string | null} payCode
 * @property {string | null} amount
 * @property {string | null} shiftTotal
 * @property {string | null} dailyTotal
 */

/**
 * @typedef {Object} ScheduleResult
 * @property {string} extractedAt
 * @property {Shift[]} shifts
 */

/**
 * @typedef {Object} TimecardResult
 * @property {string} extractedAt
 * @property {string} period
 * @property {TimecardEntry[]} entries
 */

/**
 * @typedef {Object} ScrapeResult
 * @property {ScheduleResult | null} schedule
 * @property {TimecardResult | null} timecard
 * @property {string[]} errors
 */

const BASE_URL = "https://dunnes.prd.mykronos.com";

/**
 * Fetch schedule data via the JSON API from a logged-in page.
 * @param {import("playwright").BrowserContext} context
 * @param {import("playwright").Page} page - Any page in the authenticated context
 * @returns {Promise<ScheduleResult>}
 */
async function scrapeSchedule(context, page) {
  console.error("[schedule] Fetching via API...");

  const cookies = await context.cookies();
  const xsrfCookie = cookies.find((c) => c.name === "XSRF-TOKEN");
  if (!xsrfCookie) {
    throw new Error("XSRF-TOKEN cookie not found after login");
  }

  const today = new Date();
  const start = formatDate(today);
  const end = formatDate(addDays(today, 42));

  const apiResponse = await page.evaluate(
    async ({ start, end, xsrfToken }) => {
      const r = await fetch("/myschedule/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-xsrf-token": xsrfToken,
        },
        body: JSON.stringify({
          data: {
            calendarConfigId: 3001002,
            includedEntities: [
              "entity.regularshift",
              "entity.paycodeedit",
              "entity.holiday",
              "entity.timeoffrequest",
            ],
            includedCoverRequestsStatuses: [],
            includedSwapRequestsStatuses: [],
            includedTimeOffRequestsStatuses: [],
            includedOpenShiftRequestsStatuses: [],
            includedSelfScheduleRequestsStatuses: [],
            includedAvailabilityRequestsStatuses: [],
            includedAvailabilityPatternRequestsStatuses: [],
            dateSpan: { start, end },
            showJobColoring: true,
            showOrgPathToDisplay: true,
            includeEmployeePreferences: true,
            includeNodeAddress: true,
            removeDuplicatedEntities: true,
            hideInvisibleTORPayCodes: true,
          },
        }),
      });
      if (!r.ok) {
        return { error: r.status, message: await r.text() };
      }
      return r.json();
    },
    { start, end, xsrfToken: xsrfCookie.value }
  );

  if (apiResponse.error) {
    throw new Error(`Schedule API returned ${apiResponse.error}: ${apiResponse.message}`);
  }

  const shifts = mapApiToShifts(apiResponse);
  console.error(`[schedule] Got ${shifts.length} shifts from API. Done.`);

  return { extractedAt: new Date().toISOString(), shifts };
}

/**
 * Scrape timecard data from its own page.
 * @param {import("playwright").Page} page
 * @returns {Promise<TimecardResult>}
 */
async function scrapeTimecard(page) {
  console.error("[timecard] Opening My Timecard...");
  await page.goto(BASE_URL + "/wfd/home", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.getByText("Open My Timecard").click({ timeout: 10000 });
  await page.waitForURL((url) => url.toString().includes("/myTimecard"), {
    timeout: 30000,
  });

  await page.waitForSelector("#_timeFrame", { timeout: 10000 });
  await page.waitForTimeout(3000);

  console.error("[timecard] Parsing...");
  /** @type {TimecardEntry[]} */
  const entries = await page.evaluate(() => {
    /** @type {TimecardEntry[]} */
    const results = [];

    for (let i = 0; i < 7; i++) {
      const dateEl = document.getElementById(`${i}_date`);
      if (!dateEl) continue;

      const dateText = dateEl.getAttribute("title") || dateEl.innerText.trim();
      const match = dateText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}\/\d{2})/);
      if (!match) continue;

      /** @param {string} col */
      const cell = (col) => {
        const el = document.getElementById(`${i}_${col}`);
        if (!el) return null;
        const val = (el.getAttribute("title") || el.innerText || "").trim();
        if (col.includes("punch") && val.includes(";")) {
          return val.split(";").pop().trim() || null;
        }
        return val || null;
      };

      results.push({
        date: match[2],
        day: match[1],
        schedule: cell("scheduleshift"),
        absence: cell("absence"),
        clockIn1: cell("inpunch"),
        clockOut1: cell("outpunch"),
        clockIn2: cell("inpunch2"),
        clockOut2: cell("outpunch2"),
        payCode: cell("name"),
        amount: cell("amount"),
        shiftTotal: cell("workedshifttotal"),
        dailyTotal: cell("dailytotal"),
      });
    }

    return results;
  });

  if (!entries || entries.length === 0) {
    throw new Error("Could not parse timecard data");
  }

  console.error(`[timecard] Found ${entries.length} entries. Done.`);

  return {
    extractedAt: new Date().toISOString(),
    period: "Current Pay Period",
    entries,
  };
}

/**
 * Load credentials from CLI args or config.json fallback.
 * @returns {{ username: string, password: string }}
 */
function loadCredentials() {
  const [username, password] = process.argv.slice(2);
  if (username && password) return { username, password };

  const configPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "config.json"
  );
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (config.ukg?.username && config.ukg?.password) {
      return { username: config.ukg.username, password: config.ukg.password };
    }
  }

  console.error("Usage: node scrape-all.js <username> <password>");
  console.error("Or create config.json with ukg.username and ukg.password");
  process.exit(1);
}

/** @returns {Promise<void>} */
async function main() {
  const { username, password } = loadCredentials();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    // Login
    const loginPage = await context.newPage();
    console.error("Logging in...");
    await loginPage.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await loginPage.getByLabel("Username or email").fill(username);
    await loginPage.getByLabel("Password").fill(password);
    await loginPage.getByRole("button", { name: "Sign in" }).click();
    await loginPage.waitForURL((url) => url.toString().includes("/wfd/home"), {
      timeout: 60000,
    });
    console.error("Logged in. Starting scrapes...");

    // Schedule uses API (no page navigation needed) — use loginPage directly
    // Timecard needs its own page for DOM scraping
    const timecardPage = await context.newPage();

    /** @type {string[]} */
    const errors = [];

    const [scheduleResult, timecardResult] = await Promise.allSettled([
      scrapeSchedule(context, loginPage),
      scrapeTimecard(timecardPage),
    ]);

    /** @type {ScheduleResult | null} */
    let schedule = null;
    if (scheduleResult.status === "fulfilled") {
      schedule = scheduleResult.value;
    } else {
      const msg = scheduleResult.reason?.message || String(scheduleResult.reason);
      console.error("[schedule] FAILED: " + msg);
      errors.push("Schedule scraper failed: " + msg);
    }

    /** @type {TimecardResult | null} */
    let timecard = null;
    if (timecardResult.status === "fulfilled") {
      timecard = timecardResult.value;
    } else {
      const msg = timecardResult.reason?.message || String(timecardResult.reason);
      console.error("[timecard] FAILED: " + msg);
      errors.push("Timecard scraper failed: " + msg);
      await timecardPage.screenshot({ path: "debug-timecard.png", fullPage: true }).catch(() => {});
    }

    /** @type {ScrapeResult} */
    const output = { schedule, timecard, errors };
    console.log(JSON.stringify(output, null, 2));

    if (!schedule && !timecard) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Error:", /** @type {Error} */ (err).message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
