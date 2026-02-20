import { chromium } from "playwright";

const BASE_URL = "https://dunnes.prd.mykronos.com";

async function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error("Usage: node scrape-timecard.js <username> <password>");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Step 1: Login
    console.error("Logging in...");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByLabel("Username or email").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL((url) => url.toString().includes("/wfd/home"), {
      timeout: 60000,
    });
    console.error("Logged in.");
    await page.waitForTimeout(3000);

    // Step 2: Navigate to My Timecard
    console.error("Opening My Timecard...");
    await page.getByText("Open My Timecard").click({ timeout: 10000 });
    await page.waitForURL((url) => url.toString().includes("/myTimecard"), {
      timeout: 30000,
    });

    // Step 3: Wait for the timecard grid to load
    await page.waitForSelector('#_timeFrame', { timeout: 10000 });
    await page.waitForTimeout(3000);

    // Step 4: Extract timecard data using cell ID pattern: rowIndex_columnName
    const timecard = await page.evaluate(() => {
      const entries = [];

      for (let i = 0; i < 7; i++) {
        const dateEl = document.getElementById(`${i}_date`);
        if (!dateEl) continue;

        const dateText = dateEl.getAttribute("title") || dateEl.innerText.trim();
        const match = dateText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}\/\d{2})/);
        if (!match) continue;

        const cell = (col) => {
          const el = document.getElementById(`${i}_${col}`);
          if (!el) return null;
          const val = (el.getAttribute("title") || el.innerText || "").trim();
          // For outpunch, title may contain notes before the time (e.g. "Bonus Applied; 18:45")
          if (col.includes("punch") && val.includes(";")) {
            return val.split(";").pop().trim() || null;
          }
          return val || null;
        };

        entries.push({
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

      return entries;
    });

    if (!timecard || timecard.length === 0) {
      console.error("Could not parse timecard data.");
      await page.screenshot({ path: "debug-error.png", fullPage: true });
      process.exit(1);
    }

    const output = {
      extractedAt: new Date().toISOString(),
      period: "Current Pay Period",
      entries: timecard,
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
    await page.screenshot({ path: "debug-error.png", fullPage: true }).catch(() => {});
    console.error("Debug screenshot saved to debug-error.png");
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
