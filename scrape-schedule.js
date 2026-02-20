import { chromium } from "playwright";

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

    // Step 4: Wait for the My Schedule tile to fully render with content
    // Scroll down to ensure the schedule tile is in view and loads
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForSelector('text="View My Schedule"', { timeout: 30000 });
    // Wait until actual day entries appear in the tile
    await page.waitForFunction(
      () => /\d{1,2}:\d{2}[–\-]\d{1,2}:\d{2}/.test(document.body.innerText) || document.body.innerText.includes("nothing planned"),
      { timeout: 15000 }
    );
    await page.waitForTimeout(1500); // let all days render

    const schedule = await page.evaluate(() => {
      const allText = document.body.innerText;
      // Extract the My Schedule tile content
      const tileMatch = allText.match(
        /View My Schedule\n([\s\S]*?)(?:My Accruals|My Personal Data|Loading complete)/
      );
      if (!tileMatch) return null;

      const tileText = tileMatch[1].trim();
      const lines = tileText.split("\n").map((l) => l.trim()).filter(Boolean);

      const days = [];
      const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      let current = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Day name on its own line, followed by date number on next line
        if (dayNames.includes(line) && i + 1 < lines.length && /^\d{1,2}$/.test(lines[i + 1])) {
          if (current) days.push(current);
          current = { day: line, date: parseInt(lines[i + 1]), details: [] };
          i++; // skip the date number line
        } else if (current) {
          if (line === "Today") continue;
          current.details.push(line);
        }
      }
      if (current) days.push(current);

      return days;
    });

    if (!schedule || schedule.length === 0) {
      console.error("Could not parse schedule tile. Dumping page text...");
      const debugText = await page.evaluate(() => document.body.innerText);
      console.error(debugText.substring(0, 3000));
      await page.screenshot({ path: "debug-error.png", fullPage: true });
      process.exit(1);
    }

    // Step 5: Build structured output
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    const shifts = schedule.map((day) => {
      // Resolve full date from day number
      let month = currentMonth;
      let year = currentYear;
      // If the day number is much smaller than today, it's next month
      if (day.date < today.getDate() - 15) {
        month++;
        if (month > 11) { month = 0; year++; }
      }
      const fullDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day.date).padStart(2, "0")}`;

      const timeMatch = day.details
        .join(" ")
        .match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);

      const isOff =
        day.details.some((d) => d.includes("Day Off") || d.includes("nothing planned"));

      return {
        date: fullDate,
        day: day.day,
        start: timeMatch ? timeMatch[1] : null,
        end: timeMatch ? timeMatch[2] : null,
        off: isOff,
        note: isOff ? day.details.find((d) => d.includes("Day Off") || d.includes("nothing planned")) || null : null,
      };
    });

    const output = {
      extractedAt: new Date().toISOString(),
      shifts,
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
