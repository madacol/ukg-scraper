const { chromium } = require("playwright");

const BASE_URL = "https://dunnes.prd.mykronos.com";

async function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error("Usage: node scrape-schedule.js <username> <password>");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect API schedule responses as they happen
  const apiSchedules = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (
      url.includes("/api/v1/scheduling/schedule") ||
      url.includes("/api/v1/commons/persons/schedule") ||
      url.includes("/api/v2/scheduling/schedule")
    ) {
      try {
        const json = await response.json();
        apiSchedules.push({ url, data: json });
      } catch {
        // not JSON, ignore
      }
    }
  });

  try {
    // --- Login ---
    console.error("Navigating to login page...");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });

    // The login form may be inside an iframe or directly on the page
    // Try to find the username field in the main page first, then check iframes
    let loginFrame = page;
    const usernameSelector = 'input[id="username"], input[name="username"], input[type="text"]';

    let usernameField = await page.$(usernameSelector);
    if (!usernameField) {
      // Check iframes
      for (const frame of page.frames()) {
        usernameField = await frame.$(usernameSelector);
        if (usernameField) {
          loginFrame = frame;
          break;
        }
      }
    }

    if (!usernameField) {
      throw new Error("Could not find username field on the login page");
    }

    console.error("Filling in credentials...");
    await usernameField.fill(username);

    const passwordSelector = 'input[id="password"], input[name="password"], input[type="password"]';
    await loginFrame.fill(passwordSelector, password);

    // Click the login button
    const loginButtonSelector = 'button[type="submit"], input[type="submit"], button:has-text("Log In"), button:has-text("Sign In")';
    await loginFrame.click(loginButtonSelector);

    // Wait for navigation after login
    console.error("Logging in...");
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    // Give the SPA time to fully load
    await page.waitForTimeout(5000);

    // --- Navigate to Schedule ---
    console.error("Navigating to schedule...");

    // UKG Kronos typically loads the schedule at a hash-based route or via navigation
    // Try direct navigation to the schedule page
    const scheduleUrls = [
      `${BASE_URL}/#/schedule`,
      `${BASE_URL}/timekeeping/schedule`,
      `${BASE_URL}/#/MySchedule`,
    ];

    let navigatedToSchedule = false;

    // First, try clicking a schedule link/menu item in the UI
    const scheduleNavSelectors = [
      'a:has-text("My Schedule")',
      'a:has-text("Schedule")',
      'button:has-text("My Schedule")',
      'button:has-text("Schedule")',
      '[data-testid*="schedule"]',
      '[id*="schedule"]',
      '.menu-item:has-text("Schedule")',
      'nav a:has-text("Schedule")',
    ];

    for (const sel of scheduleNavSelectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible())) {
          await el.click();
          await page.waitForTimeout(3000);
          navigatedToSchedule = true;
          console.error(`Clicked schedule nav element: ${sel}`);
          break;
        }
      } catch {
        // try next
      }
    }

    // If clicking didn't work, try direct URL navigation
    if (!navigatedToSchedule) {
      for (const url of scheduleUrls) {
        try {
          await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
          navigatedToSchedule = true;
          console.error(`Navigated to: ${url}`);
          break;
        } catch {
          // try next
        }
      }
    }

    await page.waitForTimeout(3000);

    // --- Extract Schedule Data ---
    console.error("Extracting schedule data...");

    // Build the date range for the next 7 days
    const today = new Date();
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push(d);
    }

    const dateStrings = dates.map((d) => ({
      date: d.toISOString().split("T")[0],
      dayName: d.toLocaleDateString("en-US", { weekday: "long" }),
      display: d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    }));

    // Strategy 1: Try to extract from the DOM
    const schedule = await page.evaluate((dateInfo) => {
      const results = [];

      // Look for schedule entries in common UKG DOM structures
      // UKG typically renders shifts in a table or grid
      const selectors = [
        // Table-based schedules
        "table.schedule-table tr",
        "table tr",
        // Card/tile-based schedules
        ".schedule-day",
        ".shift-card",
        ".day-cell",
        '[class*="schedule"]',
        '[class*="shift"]',
        '[class*="day-column"]',
        '[data-testid*="schedule"]',
        '[data-testid*="shift"]',
      ];

      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        if (elements.length > 0) {
          elements.forEach((el) => {
            const text = el.textContent.trim();
            if (text.length > 0 && text.length < 500) {
              results.push({ selector: sel, text });
            }
          });
        }
      }

      // Also grab any visible text that looks like a time pattern (e.g., "9:00 AM - 5:00 PM")
      const timePattern = /\d{1,2}:\d{2}\s*(AM|PM|am|pm)?\s*[-–]\s*\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/g;
      const bodyText = document.body.innerText;
      const timeMatches = bodyText.match(timePattern) || [];

      return { domEntries: results, timeMatches, bodyText: bodyText.substring(0, 10000) };
    }, dateStrings);

    // Strategy 2: Check if we captured API responses
    let apiData = null;
    if (apiSchedules.length > 0) {
      apiData = apiSchedules;
    }

    // Strategy 3: Try the UKG API directly using session cookies
    if (!apiData) {
      console.error("Trying UKG API directly...");
      const startDate = dateStrings[0].date;
      const endDate = dateStrings[dateStrings.length - 1].date;

      const apiEndpoints = [
        `/api/v1/scheduling/schedule?start_date=${startDate}&end_date=${endDate}`,
        `/api/v1/commons/persons/schedule?startDate=${startDate}&endDate=${endDate}`,
        `/api/v2/scheduling/schedule/multi_read`,
      ];

      for (const endpoint of apiEndpoints) {
        try {
          const apiResponse = await page.evaluate(
            async ({ baseUrl, ep, start, end }) => {
              // Try GET first
              let res = await fetch(`${baseUrl}${ep}`, {
                credentials: "include",
                headers: { Accept: "application/json" },
              });
              if (res.ok) {
                return await res.json();
              }

              // Try POST for multi_read endpoints
              if (ep.includes("multi_read")) {
                res = await fetch(`${baseUrl}${ep}`, {
                  method: "POST",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify({
                    where: {
                      dateRange: { startDate: start, endDate: end },
                    },
                  }),
                });
                if (res.ok) {
                  return await res.json();
                }
              }

              return null;
            },
            { baseUrl: BASE_URL, ep: endpoint, start: startDate, end: endDate }
          );

          if (apiResponse) {
            apiData = { endpoint, data: apiResponse };
            console.error(`Got data from API: ${endpoint}`);
            break;
          }
        } catch {
          // try next endpoint
        }
      }
    }

    // --- Format and output results ---
    const output = {
      extractedAt: new Date().toISOString(),
      dateRange: {
        from: dateStrings[0].date,
        to: dateStrings[dateStrings.length - 1].date,
      },
      dates: dateStrings,
    };

    if (apiData) {
      output.apiSchedule = apiData;
    }

    // Parse schedule from DOM text
    const parsedShifts = parseShiftsFromText(schedule.bodyText, dateStrings);
    if (parsedShifts.length > 0) {
      output.shifts = parsedShifts;
    }

    if (schedule.timeMatches.length > 0) {
      output.timeMatches = schedule.timeMatches;
    }

    if (schedule.domEntries.length > 0) {
      output.domEntries = schedule.domEntries.slice(0, 50);
    }

    // If nothing was found, include the raw body text for debugging
    if (
      !output.apiSchedule &&
      !output.shifts?.length &&
      !output.timeMatches?.length
    ) {
      output.rawPageText = schedule.bodyText;
      console.error(
        "Warning: Could not find structured schedule data. Including raw page text for debugging."
      );
    }

    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error("Error:", err.message);

    // Take a screenshot for debugging
    await page.screenshot({ path: "debug-screenshot.png", fullPage: true });
    console.error("Debug screenshot saved to debug-screenshot.png");

    process.exit(1);
  } finally {
    await browser.close();
  }
}

/**
 * Attempt to parse shift information from raw page text.
 * Looks for date headers followed by time ranges.
 */
function parseShiftsFromText(text, dateStrings) {
  const shifts = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Common time pattern: "9:00 AM - 5:00 PM" or "09:00 - 17:00"
  const timeRangeRegex =
    /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/;

  // Day name patterns
  const dayNames = [
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
    "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
  ];

  let currentDay = null;

  for (const line of lines) {
    // Check if line contains a day name
    for (const day of dayNames) {
      if (line.includes(day)) {
        currentDay = day;
        break;
      }
    }

    // Check for date patterns like "02/18", "2/18", "Feb 18"
    for (const ds of dateStrings) {
      if (line.includes(ds.display) || line.includes(ds.dayName)) {
        currentDay = ds.display;
      }
    }

    // Check for time range in current line
    const timeMatch = line.match(timeRangeRegex);
    if (timeMatch) {
      shifts.push({
        day: currentDay || "Unknown",
        start: timeMatch[1].trim(),
        end: timeMatch[2].trim(),
        rawLine: line,
      });
    }

    // Check for "Off", "Day Off", "Rest Day" etc.
    if (
      currentDay &&
      /\b(off|day off|rest day|no shift|free)\b/i.test(line) &&
      !timeRangeRegex.test(line)
    ) {
      shifts.push({
        day: currentDay,
        start: null,
        end: null,
        type: "day-off",
        rawLine: line,
      });
    }
  }

  return shifts;
}

main();
