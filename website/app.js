import { buildWebsiteViewModel } from "./view-model.js";

const PAST_WINDOW_DAYS = 30;
const FUTURE_WINDOW_DAYS = 42;

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
 * @param {string} isoDate
 * @param {number} days
 * @returns {string}
 */
function addIsoDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {string} isoDate
 * @returns {string}
 */
function isoToDdmm(isoDate) {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;
}

/**
 * @param {Array<any>} records
 * @returns {{ extractedAt: string, shifts: object[] } | null}
 */
function buildScheduleData(records) {
  let extractedAt = null;
  const shifts = records
    .filter((record) => record?.current?.schedule)
    .map((record) => {
      const scheduleExtractedAt = record.sources?.scheduleExtractedAt ?? null;
      if (scheduleExtractedAt && (!extractedAt || scheduleExtractedAt > extractedAt)) {
        extractedAt = scheduleExtractedAt;
      }

      return {
        date: record.date,
        day: record.day,
        ...record.current.schedule,
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date));

  if (!extractedAt || shifts.length === 0) {
    return null;
  }

  return { extractedAt, shifts };
}

/**
 * @param {Array<any>} records
 * @param {string} todayIso
 * @returns {{ extractedAt: string, period: string, entries: object[] } | null}
 */
function buildTimecardData(records, todayIso) {
  const fromIso = addIsoDays(todayIso, -(PAST_WINDOW_DAYS - 1));
  let extractedAt = null;

  const entries = records
    .filter((record) => record?.current?.timecard && record.date >= fromIso && record.date <= todayIso)
    .map((record) => {
      const timecardExtractedAt = record.sources?.timecardExtractedAt ?? null;
      if (timecardExtractedAt && (!extractedAt || timecardExtractedAt > extractedAt)) {
        extractedAt = timecardExtractedAt;
      }

      return {
        date: isoToDdmm(record.date),
        day: record.day,
        isoDate: record.date,
        ...record.current.timecard,
      };
    })
    .sort((left, right) => left.isoDate.localeCompare(right.isoDate));

  if (!extractedAt || entries.length === 0) {
    return null;
  }

  return {
    extractedAt,
    period: `Last ${PAST_WINDOW_DAYS} Days`,
    entries,
  };
}

/**
 * @param {string} todayIso
 * @returns {Promise<Array<any>>}
 */
async function loadDayRecords(todayIso) {
  const index = await fetchJson("./data/index.json");
  const dates = Array.isArray(index?.dates) ? index.dates : [];
  if (dates.length === 0) {
    return [];
  }

  const fromIso = addIsoDays(todayIso, -(PAST_WINDOW_DAYS - 1));
  const toIso = addIsoDays(todayIso, FUTURE_WINDOW_DAYS);
  const visibleDates = dates.filter((date) => date >= fromIso && date <= toIso);

  const records = await Promise.all(
    visibleDates.map((date) => fetchJson(`./data/days/${date}.json`))
  );

  return records.filter(Boolean);
}

/** @type {Record<string, string>} */
const BADGE_LABELS = {
  morning: "AM",
  evening: "PM",
  full: "Full",
};

/**
 * Returns the CSS class suffix for a shift type.
 * @param {import("./view-model.js").TimelineDay} day
 * @returns {string}
 */
function shiftTypeClasses(day) {
  const classes = [];
  if (day.shiftType) {
    classes.push(`day-shift-${day.shiftType}`);
  }
  if (day.isNonStandard) {
    classes.push("day-non-standard");
  }
  return classes.join(" ");
}

/**
 * Renders a shift type badge (AM / PM / Full).
 * @param {import("./view-model.js").TimelineDay} day
 * @returns {string}
 */
function renderShiftBadge(day) {
  if (!day.shiftType || day.shiftType === "off") return "";
  const label = BADGE_LABELS[day.shiftType] ?? "";
  if (!label) return "";
  const nonStd = day.isNonStandard ? "+" : "";
  return `<span class="shift-badge shift-badge-${day.shiftType}">${label}${nonStd}</span>`;
}

/**
 * Renders a single timeline day card.
 * @param {import("./view-model.js").TimelineDay} day
 * @returns {string}
 */
function renderDay(day) {
  const base = day.isToday ? "day day-today" : day.isPast ? "day day-past" : "day day-future";
  const shiftCls = shiftTypeClasses(day);
  const cls = shiftCls ? `${base} ${shiftCls}` : base;

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
        <strong class="day-date">${escapeHtml(day.dateLabel)}${renderShiftBadge(day)}</strong>
        ${timeRange && !isOff && !hasPunches ? `<span class="day-schedule">${timeRange}</span>` : ""}
        ${isOff ? `<span class="day-off">Off</span>` : ""}
        ${details.length > 0 ? `<div class="day-details">${details.join("")}</div>` : ""}
      </div>
      ${day.total ? `<span class="day-total">${escapeHtml(day.total)}</span>` : ""}
    </article>
  `;
}

/**
 * Renders the shift type legend.
 * @returns {string}
 */
function renderLegend() {
  return `
    <div class="legend">
      <span class="legend-item"><span class="legend-bar legend-bar-morning"></span>Morning</span>
      <span class="legend-item"><span class="legend-bar legend-bar-evening"></span>Evening</span>
      <span class="legend-item"><span class="legend-bar legend-bar-full"></span>Full day</span>
      <span class="legend-item"><span class="legend-bar legend-bar-off"></span>Off</span>
      <span class="legend-item"><span class="legend-bar-dashed"></span>Non-std</span>
    </div>
  `;
}

/**
 * Renders the full timeline grouped by weeks.
 * @param {ReturnType<typeof buildWebsiteViewModel>} model
 * @returns {string}
 */
function renderTimeline(model) {
  if (model.weekGroups.length === 0) {
    return `<p class="empty">No schedule or timecard data available.</p>`;
  }

  /** @type {string[]} */
  const parts = [];
  let insertedTodayMarker = false;

  for (const week of model.weekGroups) {
    // Week header
    const totalHtml = week.totalFormatted
      ? `<span class="week-total">${escapeHtml(week.totalFormatted)}</span>`
      : "";
    parts.push(`<div class="week-group">`);
    parts.push(`<div class="week-header"><span class="week-label">${escapeHtml(week.weekLabel)}</span>${totalHtml}</div>`);

    for (const day of week.days) {
      if (day.isToday && !insertedTodayMarker) {
        parts.push(`<div class="today-marker"><span>Today</span></div>`);
        insertedTodayMarker = true;
      }
      parts.push(renderDay(day));
    }

    parts.push(`</div>`);
  }

  // If today wasn't in the data, insert marker between past and future
  if (!insertedTodayMarker) {
    const allDays = model.weekGroups.flatMap((w) => w.days);
    const idx = allDays.findIndex((d) => d.date >= model.todayIso);
    if (idx >= 0) {
      // Find the position in parts where this day's card is
      const joinedHtml = parts.join("\n");
      return joinedHtml.replace(
        `<article class="day day-future`,
        `<div class="today-marker"><span>Today</span></div><article class="day day-future`
      );
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
    const now = new Date().toISOString();
    const todayIso = now.slice(0, 10);
    const records = await loadDayRecords(todayIso);
    const schedule = buildScheduleData(records);
    const timecard = buildTimecardData(records, todayIso);

    const model = buildWebsiteViewModel({
      schedule,
      timecard,
      now,
    });

    root.innerHTML = `
      ${renderHeader(model)}
      ${renderIssues(model.issues)}
      ${renderLegend()}
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
