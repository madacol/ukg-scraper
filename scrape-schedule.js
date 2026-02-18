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

  // Capture all API responses — the SPA fetches schedule data via XHR
  const capturedResponses = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/")) {
      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("json")) {
          const json = await response.json();
          capturedResponses.push({ url, status: response.status(), data: json });
        }
      } catch {
        // ignore non-JSON
      }
    }
  });

  try {
    // --- Step 1: Navigate to login ---
    // dunnes.prd.mykronos.com redirects to a ForgeRock OpenAM login page
    console.error("Navigating to login...");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });
    console.error("Landed on: " + page.url());

    // --- Step 2: Fill ForgeRock OpenAM login form ---
    // OpenAM uses: form name="Login", IDToken1 (username), IDToken2 (password), loginButton_0 (submit)
    // Wait for the login form to appear
    await page.waitForSelector('input[name="IDToken1"], input[id="IDToken1"]', { timeout: 30000 })
      .catch(() => null);

    const hasOpenAMForm = await page.$('input[name="IDToken1"], input[id="IDToken1"]');

    if (hasOpenAMForm) {
      console.error("Found ForgeRock OpenAM login form");
      await page.fill('input[name="IDToken1"], input[id="IDToken1"]', username);
      await page.fill('input[name="IDToken2"], input[id="IDToken2"]', password);
      await page.click('#loginButton_0');
    } else {
      // Fallback: generic login form
      console.error("OpenAM form not found, trying generic selectors...");
      await page.screenshot({ path: "debug-login-page.png", fullPage: true });
      console.error("Saved debug-login-page.png — check what the login page looks like");

      // Try common alternatives
      const usernameField = await page.$('input[type="text"], input[name="username"], input[id="username"]');
      if (!usernameField) {
        throw new Error("Cannot find any login form. See debug-login-page.png");
      }
      await usernameField.fill(username);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"], input[type="submit"]');
    }

    // Wait for post-login redirect to the main app
    console.error("Waiting for login redirect...");
    await page.waitForURL((url) => !url.toString().includes("/authn/"), { timeout: 60000 })
      .catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    console.error("Post-login URL: " + page.url());

    // --- Step 3: Navigate to My Schedule ---
    // The UKG SPA uses hash-based routing. Try clicking "My Schedule" first, then direct URLs.
    console.error("Looking for My Schedule...");
    await page.waitForTimeout(3000);

    // Check if there's a schedule-related API call already captured from the home page
    const homeScheduleData = capturedResponses.find((r) => r.url.includes("scheduling/schedule"));

    if (!homeScheduleData) {
      // Try clicking nav elements
      const clicked = await page
        .getByText("My Schedule", { exact: false })
        .first()
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (clicked) {
        console.error("Clicked 'My Schedule' link");
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);
      } else {
        // Try navigating to common schedule hash routes
        console.error("No 'My Schedule' link found, trying direct navigation...");
        await page.goto(`${BASE_URL}/#/schedule`, { waitUntil: "networkidle", timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(3000);
      }
    }

    // --- Step 4: Extract schedule data ---
    const today = new Date();
    const startDate = formatDate(today);
    const endDate = formatDate(addDays(today, 6));

    // Check if we captured schedule API responses during navigation
    const scheduleApiData = capturedResponses.filter((r) =>
      r.url.includes("scheduling/schedule") || r.url.includes("commons/persons/schedule")
    );

    let scheduleResult = null;

    if (scheduleApiData.length > 0) {
      console.error(`Captured ${scheduleApiData.length} schedule API response(s)`);
      scheduleResult = scheduleApiData;
    } else {
      // Try calling the schedule API directly using the browser session cookies
      console.error("No schedule API captured. Calling API directly...");
      scheduleResult = await page.evaluate(
        async ({ baseUrl, start, end }) => {
          // Try multi_read endpoint (documented UKG API)
          const endpoints = [
            {
              url: `${baseUrl}/api/v1/scheduling/schedule/multi_read`,
              body: {
                where: {
                  employees: { startDate: start, endDate: end },
                },
              },
            },
            {
              url: `${baseUrl}/api/v1/scheduling/schedule/multi_read`,
              body: {
                where: {
                  dateRange: { startDate: start, endDate: end },
                },
              },
            },
          ];

          for (const ep of endpoints) {
            try {
              const res = await fetch(ep.url, {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify(ep.body),
              });
              if (res.ok) {
                return { url: ep.url, status: res.status, data: await res.json() };
              }
            } catch {
              // try next
            }
          }
          return null;
        },
        { baseUrl: BASE_URL, start: startDate, end: endDate }
      );
    }

    // --- Step 5: Build output ---
    const output = {
      extractedAt: new Date().toISOString(),
      dateRange: { from: startDate, to: endDate },
    };

    if (scheduleResult) {
      // Parse shifts from API data
      const apiData = Array.isArray(scheduleResult) ? scheduleResult : [scheduleResult];
      const shifts = [];

      for (const item of apiData) {
        const data = item.data;
        if (data && data.shifts) {
          for (const shift of data.shifts) {
            shifts.push({
              date: shift.startDateTime?.split("T")[0],
              start: shift.startDateTime,
              end: shift.endDateTime,
              label: shift.label || null,
            });
          }
        }
        // Also check if schedule data is nested differently
        if (data && data.schedule && data.schedule.shifts) {
          for (const shift of data.schedule.shifts) {
            shifts.push({
              date: shift.startDateTime?.split("T")[0],
              start: shift.startDateTime,
              end: shift.endDateTime,
              label: shift.label || null,
            });
          }
        }
      }

      if (shifts.length > 0) {
        // Filter to next 7 days
        output.shifts = shifts.filter(
          (s) => s.date && s.date >= startDate && s.date <= endDate
        );
      } else {
        // Include raw API data for debugging
        output.rawApiData = apiData.map((r) => ({ url: r.url, data: r.data }));
      }
    }

    // Fallback: scrape text from the page
    if (!output.shifts || output.shifts.length === 0) {
      console.error("No shifts from API. Scraping page text...");
      const pageText = await page.evaluate(() => document.body.innerText);
      const timePattern =
        /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;
      const matches = pageText.match(timePattern);
      if (matches) {
        output.timeMatchesFromPage = matches;
      }
      if (!output.rawApiData) {
        output.pageText = pageText.substring(0, 10000);
      }
    }

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

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

function addDays(d, n) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

main();
