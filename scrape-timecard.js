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
      const rowIndexes = Array.from(document.querySelectorAll("[id$='_date']"))
        .map((element) => {
          const match = element.id.match(/^(\d+)_date$/);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((value) => value !== null)
        .sort((left, right) => left - right);

      let currentEntry = null;

      for (const i of rowIndexes) {
        const dateEl = document.getElementById(`${i}_date`);
        if (!dateEl) continue;

        const dateText = dateEl.getAttribute("title") || dateEl.innerText.trim();
        const match = dateText.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2}\/\d{2})/);

        const cell = (col) => {
          const el = document.getElementById(`${i}_${col}`);
          if (!el) return null;
          const isPunch = col.includes("punch");
          if (isPunch) {
            const timeRe = /\b(\d{1,2}:\d{2})\b/;
            for (const raw of [el.getAttribute("title"), el.innerText]) {
              if (!raw) continue;
              const m = raw.match(timeRe);
              if (m) return m[1];
            }
            return null;
          }
          const val = (el.getAttribute("title") || el.innerText || "").trim();
          return val || null;
        };

        const numberedColumns = (base) => Array.from(document.querySelectorAll(`[id^="${i}_${base}"]`))
          .map((element) => {
            const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const match = element.id.match(new RegExp(`^${i}_${escapedBase}(\\d*)$`));
            if (!match) return null;
            return { col: `${base}${match[1]}`, n: match[1] ? Number(match[1]) : 1 };
          })
          .filter(Boolean)
          .sort((left, right) => left.n - right.n)
          .map((item) => item.col);

        const lastValue = (base) => {
          const values = numberedColumns(base).map((col) => cell(col)).filter(Boolean);
          return values.length > 0 ? values[values.length - 1] : null;
        };

        const nextPunchIndex = (entry) => {
          let next = 1;
          while (entry[`clockIn${next}`] || entry[`clockOut${next}`]) next += 1;
          return next;
        };

        const appendPunches = (entry) => {
          const inPunchColumns = numberedColumns("inpunch");
          const outPunchColumns = numberedColumns("outpunch");
          const maxPunches = Math.max(inPunchColumns.length, outPunchColumns.length);
          for (let punchIndex = 1; punchIndex <= maxPunches; punchIndex += 1) {
            const suffix = punchIndex === 1 ? "" : String(punchIndex);
            const clockIn = cell(`inpunch${suffix}`);
            const clockOut = cell(`outpunch${suffix}`);
            if (!clockIn && !clockOut) continue;
            const targetIndex = nextPunchIndex(entry);
            entry[`clockIn${targetIndex}`] = clockIn;
            entry[`clockOut${targetIndex}`] = clockOut;
          }
        };

        const applyTotals = (entry) => {
          entry.shiftTotal = lastValue("workedshifttotal") || entry.shiftTotal || null;
          entry.dailyTotal = lastValue("dailytotal") || lastValue("workedshifttotal") || entry.dailyTotal || null;
        };

        if (!match) {
          if (currentEntry) {
            appendPunches(currentEntry);
            applyTotals(currentEntry);
          }
          continue;
        }

        currentEntry = {
          date: match[2],
          day: match[1],
          schedule: cell("scheduleshift"),
          absence: cell("absence"),
          payCode: cell("name"),
          amount: cell("amount"),
          shiftTotal: null,
          dailyTotal: null,
        };

        appendPunches(currentEntry);
        applyTotals(currentEntry);

        currentEntry.clockIn1 ??= null;
        currentEntry.clockOut1 ??= null;
        currentEntry.clockIn2 ??= null;
        currentEntry.clockOut2 ??= null;

        entries.push(currentEntry);
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
