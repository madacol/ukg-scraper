import { buildWebsiteViewModel } from "./view-model.js";

/**
 * @param {string} path
 * @returns {Promise<object | null>}
 */
async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

/**
 * @param {string[]} issues
 * @returns {string}
 */
function renderIssues(issues) {
  if (issues.length === 0) {
    return `
      <div class="issue issue-ok">
        <span class="issue-label">Status</span>
        <p>Loaded the latest files from <code>data/</code>.</p>
      </div>
    `;
  }

  return issues.map((issue) => `
    <div class="issue">
      <span class="issue-label">Attention</span>
      <p>${escapeHtml(issue)}</p>
    </div>
  `).join("");
}

/**
 * @param {import("./view-model.js").buildWebsiteViewModel extends (...args: any[]) => infer T ? T : never} model
 * @returns {string}
 */
function renderSummary(model) {
  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">UKG Snapshot</p>
        <h1>Current info from the <code>data/</code> folder.</h1>
        <p class="lede">No live scraping here. This page only shows whatever was last written to the repo.</p>
      </div>
      <div class="hero-panel">
        <p class="panel-label">Next shift</p>
        <strong>${model.nextShift ? escapeHtml(model.nextShift.dateLabel) : "No upcoming shift"}</strong>
        <span>${model.nextShift ? escapeHtml(model.nextShift.timeRange) : "Check the schedule files"}</span>
        ${model.nextShift?.breakLabel ? `<em>${escapeHtml(model.nextShift.breakLabel)}</em>` : ""}
      </div>
    </section>

    <section class="metrics">
      <article class="metric">
        <span class="metric-label">Upcoming shifts</span>
        <strong>${model.scheduleSummary.upcomingCount}</strong>
        <small class="${model.scheduleSummary.isStale ? "stale" : "fresh"}">
          Schedule file: ${escapeHtml(model.scheduleSummary.extractedLabel)}
        </small>
      </article>
      <article class="metric">
        <span class="metric-label">Tracked days</span>
        <strong>${model.timecardSummary.trackedDays}</strong>
        <small>${escapeHtml(model.timecardSummary.period ?? "No timecard period")}</small>
      </article>
      <article class="metric">
        <span class="metric-label">Total worked</span>
        <strong>${escapeHtml(model.timecardSummary.totalHours)}</strong>
        <small class="${model.timecardSummary.isStale ? "stale" : "fresh"}">
          Timecard file: ${escapeHtml(model.timecardSummary.extractedLabel)}
        </small>
      </article>
    </section>
  `;
}

/**
 * @param {ReturnType<typeof buildWebsiteViewModel>} model
 * @returns {string}
 */
function renderSchedule(model) {
  if (model.upcomingShifts.length === 0) {
    return `
      <section class="panel">
        <div class="section-heading">
          <p class="eyebrow">Schedule</p>
          <h2>No upcoming shifts in the current file.</h2>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="section-heading">
        <p class="eyebrow">Schedule</p>
        <h2>Upcoming shifts</h2>
      </div>
      <div class="list">
        ${model.upcomingShifts.map((shift) => `
          <article class="list-row">
            <div>
              <strong>${escapeHtml(shift.dateLabel)}</strong>
              <p>${escapeHtml(shift.timeRange)}</p>
            </div>
            <div class="row-meta">
              ${shift.breakLabel ? `<span>${escapeHtml(shift.breakLabel)}</span>` : ""}
              ${shift.note ? `<span>${escapeHtml(shift.note)}</span>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

/**
 * @param {ReturnType<typeof buildWebsiteViewModel>} model
 * @returns {string}
 */
function renderTimecard(model) {
  if (model.recentEntries.length === 0) {
    return `
      <section class="panel">
        <div class="section-heading">
          <p class="eyebrow">Timecard</p>
          <h2>No recent entries in the current file.</h2>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="section-heading">
        <p class="eyebrow">Timecard</p>
        <h2>Latest entries</h2>
      </div>
      <div class="list">
        ${model.recentEntries.map((entry) => `
          <article class="list-row">
            <div>
              <strong>${escapeHtml(entry.dateLabel)}</strong>
              <p>${escapeHtml(entry.punches ?? "No punches recorded")}</p>
            </div>
            <div class="row-meta">
              ${entry.total ? `<span>Total ${escapeHtml(entry.total)}</span>` : ""}
              ${entry.payCode ? `<span>${escapeHtml(entry.payCode)}</span>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

async function main() {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Missing #app container");
  }

  try {
    const [schedule, timecard] = await Promise.all([
      fetchJson("./data/schedule-latest.json"),
      fetchJson("./data/timecard-latest.json"),
    ]);

    const model = buildWebsiteViewModel({
      schedule,
      timecard,
      now: new Date().toISOString(),
    });

    root.innerHTML = `
      ${renderSummary(model)}
      <section class="issues">
        ${renderIssues(model.issues)}
      </section>
      <div class="two-up">
        ${renderSchedule(model)}
        ${renderTimecard(model)}
      </div>
    `;
  } catch (error) {
    root.innerHTML = `
      <section class="issue issue-fatal">
        <span class="issue-label">Error</span>
        <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
      </section>
    `;
  }
}

main();
