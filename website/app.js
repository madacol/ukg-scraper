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
 * Renders a single timeline day card.
 * @param {import("./view-model.js").TimelineDay} day
 * @returns {string}
 */
function renderDay(day) {
  const cls = day.isToday ? "day day-today" : day.isPast ? "day day-past" : "day day-future";

  const timeRange = day.timeRange ? escapeHtml(day.timeRange) : null;
  const isOff = timeRange === "Off";

  const hasPunches = Boolean(day.punches);

  /** @type {string[]} */
  const details = [];

  if (hasPunches) {
    details.push(`<span class="day-punches">${escapeHtml(day.punches)}</span>`);
  }
  if (hasPunches && timeRange && !isOff) {
    details.push(`<span class="day-scheduled-label">Scheduled ${timeRange}</span>`);
  }
  if (day.breakLabel) {
    details.push(`<span class="day-break">${escapeHtml(day.breakLabel)}</span>`);
  }
  if (day.note && day.note !== day.timeRange) {
    details.push(`<span class="day-note">${escapeHtml(day.note)}</span>`);
  }

  return `
    <article class="${cls}" ${day.isToday ? 'id="today"' : ""}>
      <div class="day-left">
        <strong class="day-date">${escapeHtml(day.dateLabel)}</strong>
        ${timeRange && !isOff && !hasPunches ? `<span class="day-schedule">${timeRange}</span>` : ""}
        ${isOff ? `<span class="day-off">Off</span>` : ""}
        ${details.length > 0 ? `<div class="day-details">${details.join("")}</div>` : ""}
      </div>
      ${day.total ? `<span class="day-total">${escapeHtml(day.total)}</span>` : ""}
    </article>
  `;
}

/**
 * Renders the full timeline.
 * @param {ReturnType<typeof buildWebsiteViewModel>} model
 * @returns {string}
 */
function renderTimeline(model) {
  if (model.timelineDays.length === 0) {
    return `<p class="empty">No schedule or timecard data available.</p>`;
  }

  /** @type {string[]} */
  const parts = [];
  let insertedTodayMarker = false;

  for (const day of model.timelineDays) {
    if (day.isToday && !insertedTodayMarker) {
      parts.push(`<div class="today-marker"><span>Today</span></div>`);
      insertedTodayMarker = true;
    }
    parts.push(renderDay(day));
  }

  // If today wasn't in the data, insert marker between past and future
  if (!insertedTodayMarker) {
    const idx = model.timelineDays.findIndex((d) => d.date >= model.todayIso);
    if (idx >= 0) {
      parts.splice(idx, 0, `<div class="today-marker"><span>Today</span></div>`);
    }
  }

  return parts.join("");
}

/**
 * Renders issue warnings if any.
 * @param {string[]} issues
 * @returns {string}
 */
function renderIssues(issues) {
  if (issues.length === 0) {
    return "";
  }
  return issues.map((issue) => `
    <div class="issue">
      <span class="issue-dot"></span>
      <span>${escapeHtml(issue)}</span>
    </div>
  `).join("");
}

/**
 * Renders the summary bar at the top.
 * @param {ReturnType<typeof buildWebsiteViewModel>} model
 * @returns {string}
 */
function renderHeader(model) {
  return `
    <header class="header">
      <div class="header-left">
        <h1>Schedule</h1>
        ${model.nextShift
          ? `<p class="next-shift">Next: <strong>${escapeHtml(model.nextShift.dateLabel)}</strong> ${escapeHtml(model.nextShift.timeRange)}</p>`
          : `<p class="next-shift">No upcoming shifts</p>`
        }
      </div>
      <div class="header-right">
        <span class="stat">${escapeHtml(model.timecardSummary.totalHours)} <small>worked</small></span>
        <span class="stat">${model.timecardSummary.trackedDays} <small>days</small></span>
      </div>
    </header>
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
      ${renderHeader(model)}
      ${renderIssues(model.issues)}
      <div class="timeline">
        ${renderTimeline(model)}
      </div>
    `;

    root.classList.remove("app-loading");

    // Scroll today into view
    const todayEl = document.getElementById("today");
    if (todayEl) {
      todayEl.scrollIntoView({ block: "center" });
    }
  } catch (error) {
    root.innerHTML = `
      <div class="issue">
        <span class="issue-dot issue-dot-error"></span>
        <span>${escapeHtml(error instanceof Error ? error.message : String(error))}</span>
      </div>
    `;
  }
}

main();
