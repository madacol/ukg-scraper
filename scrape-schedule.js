import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatDate, addDays, mapApiToShifts } from "./schedule-utils.js";

/** @typedef {import("./schedule-utils.js").Shift} Shift */

const BASE_URL = "https://dunnes.prd.mykronos.com";

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

  console.error("Usage: node scrape-schedule.js <username> <password>");
  console.error("Or create config.json with ukg.username and ukg.password");
  process.exit(1);
}

/** @returns {Promise<void>} */
async function main() {
  const { username, password } = loadCredentials();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Login
    console.error("Logging in...");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByLabel("Username or email").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => url.toString().includes("/wfd/home"), {
      timeout: 60000,
    });
    console.error("Logged in.");

    // Read XSRF token from cookies
    const cookies = await context.cookies();
    const xsrfCookie = cookies.find((c) => c.name === "XSRF-TOKEN");
    if (!xsrfCookie) {
      throw new Error("XSRF-TOKEN cookie not found after login");
    }

    // Fetch schedule via API
    const today = new Date();
    const start = formatDate(today);
    const end = formatDate(addDays(today, 42));

    console.error("Fetching schedule via API...");
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
    console.error(`Got ${shifts.length} shifts from API.`);

    const output = {
      extractedAt: new Date().toISOString(),
      shifts,
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error("Error:", /** @type {Error} */ (err).message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
