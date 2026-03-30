/**
 * @typedef {{ start: string, end: string }} ShiftSegment
 */

/**
 * @typedef {{
 *   date: string,
 *   day: string,
 *   start: string | null,
 *   end: string | null,
 *   off: boolean,
 *   note: string | null,
 *   segments?: ShiftSegment[],
 * }} ScheduleShift
 */

/**
 * @typedef {{
 *   extractedAt: string,
 *   shifts: ScheduleShift[],
 * }} ScheduleData
 */

/**
 * @typedef {{
 *   date: string,
 *   day: string,
 *   schedule?: string | null,
 *   absence?: string | null,
 *   clockIn1?: string | null,
 *   clockOut1?: string | null,
 *   clockIn2?: string | null,
 *   clockOut2?: string | null,
 *   payCode?: string | null,
 *   amount?: string | null,
 *   shiftTotal?: string | null,
 *   dailyTotal?: string | null,
 * }} TimecardEntry
 */

/**
 * @typedef {{
 *   extractedAt: string,
 *   period: string,
 *   entries: TimecardEntry[],
 * }} TimecardData
 */

/**
 * @typedef {{
 *   date: string,
 *   dateLabel: string,
 *   timeRange: string,
 *   breakLabel: string | null,
 *   note: string | null,
 * }} UpcomingShiftCard
 */

/**
 * @typedef {{
 *   dateLabel: string,
 *   punches: string | null,
 *   total: string | null,
 *   payCode: string | null,
 * }} RecentEntryCard
 */

/**
 * @typedef {{
 *   date: string,
 *   dateLabel: string,
 *   isToday: boolean,
 *   isPast: boolean,
 *   timeRange: string | null,
 *   breakLabel: string | null,
 *   note: string | null,
 *   punches: string | null,
 *   total: string | null,
 *   payCode: string | null,
 * }} TimelineDay
 */

/**
 * @typedef {{
 *   todayIso: string,
 *   nextShift: UpcomingShiftCard | null,
 *   scheduleSummary: {
 *     extractedAt: string | null,
 *     extractedLabel: string,
 *     isStale: boolean,
 *     upcomingCount: number,
 *   },
 *   timecardSummary: {
 *     extractedAt: string | null,
 *     extractedLabel: string,
 *     isStale: boolean,
 *     trackedDays: number,
 *     totalHours: string,
 *     period: string | null,
 *   },
 *   upcomingShifts: UpcomingShiftCard[],
 *   recentEntries: RecentEntryCard[],
 *   timelineDays: TimelineDay[],
 *   issues: string[],
 * }} WebsiteViewModel
 */

/**
 * @typedef {{
 *   schedule: ScheduleData | null,
 *   timecard: TimecardData | null,
 *   now?: string,
 * }} BuildWebsiteViewModelInput
 */

/** @type {readonly string[]} */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
function parseDuration(value) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d+):(\d{2})$/);
  if (!match) {
    return null;
  }

  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/**
 * @param {number} minutes
 * @returns {string}
 */
function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}:${String(remainder).padStart(2, "0")}`;
}

/**
 * @param {string} isoDate
 * @param {string} day
 * @returns {string}
 */
function formatIsoDate(isoDate, day) {
  const month = MONTHS[parseInt(isoDate.slice(5, 7), 10) - 1];
  const date = parseInt(isoDate.slice(8, 10), 10);
  return `${day} ${date} ${month}`;
}

/**
 * @param {string} ddmm
 * @param {Date} referenceDate
 * @returns {string}
 */
function resolveDdmmIso(ddmm, referenceDate) {
  const [dateText, monthText] = ddmm.split("/").map(Number);
  let year = referenceDate.getUTCFullYear();

  if (monthText === 12 && referenceDate.getUTCMonth() === 0) {
    year -= 1;
  }

  return `${year}-${String(monthText).padStart(2, "0")}-${String(dateText).padStart(2, "0")}`;
}

/**
 * @param {ScheduleShift} shift
 * @returns {string}
 */
function formatShiftTimeRange(shift) {
  if (shift.start && shift.end) {
    return `${shift.start} - ${shift.end}`;
  }

  if (shift.note) {
    return shift.note;
  }

  return shift.off ? "Off" : "No details";
}

/**
 * @param {ShiftSegment[] | undefined} segments
 * @returns {string | null}
 */
function formatBreakLabel(segments) {
  if (!segments || segments.length < 2) {
    return null;
  }

  return `Break ${segments[0].end} - ${segments[1].start}`;
}

/**
 * @param {TimecardEntry} entry
 * @returns {string | null}
 */
function formatPunches(entry) {
  /** @type {string[]} */
  const parts = [];

  if (entry.clockIn1) {
    parts.push(`${entry.clockIn1} - ${entry.clockOut1 ?? "?"}`);
  }

  if (entry.clockIn2) {
    parts.push(`${entry.clockIn2} - ${entry.clockOut2 ?? "?"}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * @param {string | null | undefined} extractedAt
 * @param {string} todayIso
 * @returns {{ extractedLabel: string, isStale: boolean }}
 */
function summarizeFreshness(extractedAt, todayIso) {
  if (!extractedAt) {
    return { extractedLabel: "Missing", isStale: true };
  }

  const extractedDate = extractedAt.slice(0, 10);
  const diff = Math.round((Date.parse(todayIso) - Date.parse(extractedDate)) / 86400000);
  return {
    extractedLabel: extractedAt.replace("T", " ").replace(".000Z", "Z"),
    isStale: diff > 1,
  };
}

/**
 * @param {BuildWebsiteViewModelInput} input
 * @returns {WebsiteViewModel}
 */
function buildWebsiteViewModel(input) {
  const now = input.now ?? new Date().toISOString();
  const todayIso = now.slice(0, 10);
  const referenceDate = new Date(`${todayIso}T00:00:00.000Z`);
  const issues = [];

  const scheduleFreshness = summarizeFreshness(input.schedule?.extractedAt, todayIso);
  const timecardFreshness = summarizeFreshness(input.timecard?.extractedAt, todayIso);

  if (!input.schedule) {
    issues.push("Schedule data file is missing.");
  } else if (scheduleFreshness.isStale) {
    issues.push("Schedule data is older than one day.");
  }

  if (!input.timecard) {
    issues.push("Timecard data file is missing.");
  } else if (timecardFreshness.isStale) {
    issues.push("Timecard data is older than one day.");
  }

  const upcomingShifts = (input.schedule?.shifts ?? [])
    .filter((shift) => shift.date >= todayIso)
    .map((shift) => ({
      date: shift.date,
      dateLabel: formatIsoDate(shift.date, shift.day),
      timeRange: formatShiftTimeRange(shift),
      breakLabel: formatBreakLabel(shift.segments),
      note: shift.note,
    }));

  const nextShift = upcomingShifts.find((shift) => shift.timeRange !== "Off" && shift.timeRange !== "No details") ?? null;

  const recentEntries = [...(input.timecard?.entries ?? [])]
    .sort((left, right) => resolveDdmmIso(right.date, referenceDate).localeCompare(resolveDdmmIso(left.date, referenceDate)))
    .map((entry) => ({
      dateLabel: formatIsoDate(resolveDdmmIso(entry.date, referenceDate), entry.day),
      punches: formatPunches(entry),
      total: entry.dailyTotal ?? entry.shiftTotal ?? null,
      payCode: entry.payCode ?? null,
    }));

  const totalMinutes = (input.timecard?.entries ?? []).reduce((sum, entry) => {
    const minutes = parseDuration(entry.dailyTotal ?? entry.shiftTotal);
    return sum + (minutes ?? 0);
  }, 0);

  // --- Build unified timeline ---
  /** @type {Map<string, TimelineDay>} */
  const dayMap = new Map();

  // Seed from schedule shifts
  for (const shift of input.schedule?.shifts ?? []) {
    dayMap.set(shift.date, {
      date: shift.date,
      dateLabel: formatIsoDate(shift.date, shift.day),
      isToday: shift.date === todayIso,
      isPast: shift.date < todayIso,
      timeRange: formatShiftTimeRange(shift),
      breakLabel: formatBreakLabel(shift.segments),
      note: shift.note,
      punches: null,
      total: null,
      payCode: null,
    });
  }

  // Merge timecard entries
  for (const entry of input.timecard?.entries ?? []) {
    const isoDate = resolveDdmmIso(entry.date, referenceDate);
    const existing = dayMap.get(isoDate);
    const punches = formatPunches(entry);
    const total = entry.dailyTotal ?? entry.shiftTotal ?? null;
    const payCode = entry.payCode ?? null;
    const timecardSchedule = entry.schedule ?? null;

    if (existing) {
      existing.punches = punches;
      existing.total = total;
      existing.payCode = payCode;
      if (!existing.timeRange && timecardSchedule) {
        existing.timeRange = timecardSchedule;
      }
    } else {
      dayMap.set(isoDate, {
        date: isoDate,
        dateLabel: formatIsoDate(isoDate, entry.day),
        isToday: isoDate === todayIso,
        isPast: isoDate < todayIso,
        timeRange: timecardSchedule,
        breakLabel: null,
        note: null,
        punches,
        total,
        payCode,
      });
    }
  }

  const timelineDays = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    todayIso,
    nextShift,
    scheduleSummary: {
      extractedAt: input.schedule?.extractedAt ?? null,
      extractedLabel: scheduleFreshness.extractedLabel,
      isStale: scheduleFreshness.isStale,
      upcomingCount: upcomingShifts.length,
    },
    timecardSummary: {
      extractedAt: input.timecard?.extractedAt ?? null,
      extractedLabel: timecardFreshness.extractedLabel,
      isStale: timecardFreshness.isStale,
      trackedDays: input.timecard?.entries.length ?? 0,
      totalHours: formatDuration(totalMinutes),
      period: input.timecard?.period ?? null,
    },
    upcomingShifts,
    recentEntries,
    timelineDays,
    issues,
  };
}

export { buildWebsiteViewModel };
