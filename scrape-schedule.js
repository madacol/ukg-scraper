import { chromium } from "playwright";

const BASE_URL = "https://dunnes.prd.mykronos.com";
const WEEKS_TO_FETCH = 6;

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

function addDays(d, n) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

// Build a lookup table of expected dates covering the fetch window.
// Maps (dayName, dayOfMonth) pairs to full ISO date strings.
// Within a ~7-week span this pair is always unique.
function buildDateLookup() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayNameMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const lookup = new Map();
  // Start 7 days before today (the schedule page may show the full current week)
  // and extend 7 days past the fetch window for safety
  for (let i = -7; i < WEEKS_TO_FETCH * 7 + 7; i++) {
    const d = addDays(today, i);
    const key = `${dayNameMap[d.getDay()]}_${d.getDate()}`;
    lookup.set(key, formatDate(d));
  }
  return lookup;
}

// Extract day entries from the current page text.
// Handles multiple text formats the schedule page may use.
function parseDaysFromText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const days = [];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern 1: "Mon" on one line, "21" on the next
    if (
      dayNames.includes(line) &&
      i + 1 < lines.length &&
      /^\d{1,2}$/.test(lines[i + 1])
    ) {
      if (current) days.push(current);
      current = { day: line, dateNum: parseInt(lines[i + 1]), details: [] };
      i++; // skip the date number line
      continue;
    }

    // Pattern 2: "Mon 21" on one line
    const sameLine = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})$/);
    if (sameLine) {
      if (current) days.push(current);
      current = { day: sameLine[1], dateNum: parseInt(sameLine[2]), details: [] };
      continue;
    }

    // Pattern 3: "Mon, Feb 21" or "Monday, February 21"
    const longDate = line.match(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+\w+\s+(\d{1,2})/
    );
    if (longDate) {
      if (current) days.push(current);
      current = {
        day: longDate[1].substring(0, 3),
        dateNum: parseInt(longDate[2]),
        details: [],
      };
      continue;
    }

    // Accumulate detail lines for the current day
    if (current) {
      if (line === "Today") continue;
      current.details.push(line);
    }
  }
  if (current) days.push(current);
  return days;
}

// Try multiple strategies to click the "next week" navigation button.
async function goToNextWeek(page) {
  const strategies = [
    () => page.click('[aria-label="Next"]', { timeout: 2000 }),
    () => page.click('[aria-label="next"]', { timeout: 2000 }),
    () => page.click('[aria-label="Next period"]', { timeout: 2000 }),
    () => page.click('[aria-label="Next Week"]', { timeout: 2000 }),
    () => page.click('[aria-label="Forward"]', { timeout: 2000 }),
    () => page.click('button[aria-label*="next" i]', { timeout: 2000 }),
    () => page.click('button[aria-label*="forward" i]', { timeout: 2000 }),
    () =>
      page.evaluate(() => {
        // Look for arrow/chevron buttons typically used for week navigation
        const buttons = Array.from(document.querySelectorAll("button"));
        const arrow = buttons.find((b) => {
          const txt = b.textContent.trim();
          return (
            txt === "›" ||
            txt === ">" ||
            txt === "→" ||
            txt === "▶" ||
            txt === "chevron_right"
          );
        });
        if (arrow) {
          arrow.click();
          return true;
        }
        // Try paired navigation buttons (prev/next) — click the second one
        const navPairs = buttons.filter(
          (b) =>
            b.querySelector("svg") &&
            b.closest(
              '[class*="nav"], [class*="header"], [class*="toolbar"], [class*="calendar"]'
            )
        );
        if (navPairs.length >= 2) {
          navPairs[navPairs.length - 1].click();
          return true;
        }
        return false;
      }),
  ];

  for (const strategy of strategies) {
    try {
      const result = await strategy();
      if (result !== false) {
        console.error("  Navigated to next week");
        return true;
      }
    } catch {
      // try next strategy
    }
  }

  console.error("  Could not find next-week navigation button");
  await page
    .screenshot({ path: "debug-navigation.png", fullPage: true })
    .catch(() => {});
  console.error("  Debug screenshot saved to debug-navigation.png");
  return false;
}

async function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error("Usage: node scrape-schedule.js <username> <password>");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Step 1: Navigate to login
    console.error("Logging in...");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });

    // Step 2: Fill login form (UKG universal login)
    await page.getByLabel("Username or email").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // Step 3: Wait for redirect to home page
    await page.waitForURL((url) => url.toString().includes("/wfd/home"), {
      timeout: 60000,
    });
    console.error("Logged in.");

    // Step 4: Navigate to the full My Schedule page
    console.error("Opening full schedule view...");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForSelector('text="View My Schedule"', { timeout: 30000 });
    await page.getByText("View My Schedule").click();

    // Wait for schedule page to load
    await page.waitForTimeout(5000);
    console.error("Schedule page URL: " + page.url());

    // Wait for schedule content to appear
    await page.waitForFunction(
      () =>
        /\d{1,2}:\d{2}[–\-]\d{1,2}:\d{2}/.test(document.body.innerText) ||
        document.body.innerText.includes("Day Off") ||
        document.body.innerText.includes("nothing planned"),
      { timeout: 15000 }
    );
    await page.waitForTimeout(1500); // let content fully render

    // Step 5: Collect schedule data for 6 weeks
    const dateLookup = buildDateLookup();
    const allShifts = [];

    for (let week = 0; week < WEEKS_TO_FETCH; week++) {
      console.error(`Scraping week ${week + 1} of ${WEEKS_TO_FETCH}...`);
      await page.waitForTimeout(2000);

      const pageText = await page.evaluate(() => document.body.innerText);
      const rawDays = parseDaysFromText(pageText);

      if (rawDays.length > 0) {
        console.error(`  Found ${rawDays.length} days`);

        for (const rawDay of rawDays) {
          const key = `${rawDay.day}_${rawDay.dateNum}`;
          const fullDate = dateLookup.get(key);
          if (!fullDate) {
            console.error(
              `  Warning: Could not resolve date for ${rawDay.day} ${rawDay.dateNum}`
            );
            continue;
          }

          const timeMatch = rawDay.details
            .join(" ")
            .match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);

          const isOff = rawDay.details.some(
            (d) => d.includes("Day Off") || d.includes("nothing planned")
          );

          allShifts.push({
            date: fullDate,
            day: rawDay.day,
            start: timeMatch ? timeMatch[1] : null,
            end: timeMatch ? timeMatch[2] : null,
            off: isOff,
            note: isOff
              ? rawDay.details.find(
                  (d) =>
                    d.includes("Day Off") || d.includes("nothing planned")
                ) || null
              : null,
          });
        }
      } else {
        console.error("  No schedule data found for this week");
      }

      // Navigate to next week (except after last week)
      if (week < WEEKS_TO_FETCH - 1) {
        const navigated = await goToNextWeek(page);
        if (!navigated) {
          console.error("Could not navigate to next week. Stopping.");
          break;
        }
        // Wait for new week content to load
        await page.waitForTimeout(3000);
      }
    }

    if (allShifts.length === 0) {
      console.error("Could not parse any schedule data. Dumping page text...");
      const debugText = await page.evaluate(() => document.body.innerText);
      console.error(debugText.substring(0, 3000));
      await page.screenshot({ path: "debug-error.png", fullPage: true });
      process.exit(1);
    }

    // Step 6: Deduplicate by date (keep latest data for each date) and sort
    const shiftsByDate = new Map();
    for (const shift of allShifts) {
      shiftsByDate.set(shift.date, shift);
    }
    const shifts = [...shiftsByDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    const output = {
      extractedAt: new Date().toISOString(),
      shifts,
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
    await page
      .screenshot({ path: "debug-error.png", fullPage: true })
      .catch(() => {});
    console.error("Debug screenshot saved to debug-error.png");
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
