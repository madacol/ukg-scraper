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
 *   isoDate?: string,
 *   day: string,
 *   schedule?: string | null,
 *   absence?: string | null,
 *   clockIn1?: string | null,
 *   clockOut1?: string | null,
 *   clockIn2?: string | null,
 *   clockOut2?: string | null,
 *   [key: string]: unknown,
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
 * @typedef {"morning" | "evening" | "full" | "off"} ShiftType
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
 *   scrapedTotal: string | null,
 *   calculatedTotal: string | null,
 *   payCode: string | null,
 *   shiftType: ShiftType | null,
 *   isNonStandard: boolean,
 * }} TimelineDay
 */

/**
 * @typedef {{
 *   weekLabel: string,
 *   days: TimelineDay[],
 *   totalFormatted: string,
 * }} WeekGroup
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
 *     scrapedHours: string,
 *     calculatedHours: string,
 *     period: string | null,
 *   },
 *   upcomingShifts: UpcomingShiftCard[],
 *   recentEntries: RecentEntryCard[],
 *   timelineDays: TimelineDay[],
 *   weekGroups: WeekGroup[],
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
/** @type {readonly string[]} */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
 * @param {string} isoDate
 * @returns {string}
 */
function getIsoDayName(isoDate) {
  return DAYS[new Date(`${isoDate}T00:00:00.000Z`).getUTCDay()];
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
 * @param {TimecardEntry & { isoDate?: string }} entry
 * @param {Date} referenceDate
 * @returns {string}
 */
function getTimecardIsoDate(entry, referenceDate) {
  return entry.isoDate ?? resolveDdmmIso(entry.date, referenceDate);
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

  for (let i = 1; i <= 10; i += 1) {
    const clockIn = entry[`clockIn${i}`];
    const clockOut = entry[`clockOut${i}`];
    if (clockIn) {
      parts.push(`${clockIn} - ${clockOut ?? "?"}`);
    }
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * @param {TimecardEntry} entry
 * @returns {string | null}
 */
function calculatePunchTotal(entry) {
  let minutes = 0;

  for (let i = 1; i <= 10; i += 1) {
    const clockIn = typeof entry[`clockIn${i}`] === "string" ? entry[`clockIn${i}`] : null;
    const clockOut = typeof entry[`clockOut${i}`] === "string" ? entry[`clockOut${i}`] : null;
    if (!clockIn || !clockOut) continue;

    const inMinutes = parseTimeToMinutes(clockIn);
    const outMinutes = parseTimeToMinutes(clockOut);
    if (outMinutes > inMinutes) {
      minutes += outMinutes - inMinutes;
    }
  }

  return minutes > 0 ? formatDuration(minutes) : null;
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
 * Parses a time string like "9:00" or "14:30" into minutes since midnight.
 * @param {string} time
 * @returns {number}
 */
function parseTimeToMinutes(time) {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/**
 * Classifies a shift by its time range into a type and standard/non-standard flag.
 *
 * Standard durations: morning/evening ≈ 5h (300 min), full day ≈ 10h (600 min).
 * Non-standard means the actual duration deviates by more than 30 minutes.
 *
 * @param {string | null} timeRange - e.g. "9:00 - 14:00", "Off", "Easter Holiday", or null
 * @param {boolean} off - whether the day is explicitly marked off
 * @returns {{ shiftType: ShiftType | null, isNonStandard: boolean }}
 */
function classifyShift(timeRange, off) {
  if (off) return { shiftType: "off", isNonStandard: false };
  if (!timeRange || timeRange === "Off") return { shiftType: null, isNonStandard: false };

  const match = timeRange.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!match) return { shiftType: null, isNonStandard: false };

  const startMin = parseTimeToMinutes(match[1]);
  const endMin = parseTimeToMinutes(match[2]);
  const duration = endMin - startMin;

  /** @type {ShiftType} */
  let shiftType;
  let standardDuration;

  if (startMin < 720 && endMin > 960) {
    // Starts before noon, ends after 16:00 → full day
    shiftType = "full";
    standardDuration = 600;
  } else if (startMin < 720) {
    shiftType = "morning";
    standardDuration = 300;
  } else {
    shiftType = "evening";
    standardDuration = 300;
  }

  const isNonStandard = Math.abs(duration - standardDuration) > 30;
  return { shiftType, isNonStandard };
}

/**
 * Computes the number of minutes for a day, using actual total if available,
 * otherwise falling back to scheduled time range duration only for today/future
 * days. Past days without a timecard total contribute 0.
 *
 * @param {{ total: string | null, timeRange: string | null, isPast?: boolean }} day
 * @returns {number}
 */
function computeDayMinutes(day) {
  if (day.total) {
    return parseDuration(day.total) ?? 0;
  }
  if (day.isPast) return 0;
  if (!day.timeRange) return 0;

  const match = day.timeRange.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!match) return 0;

  return parseTimeToMinutes(match[2]) - parseTimeToMinutes(match[1]);
}

/**
 * Returns the ISO date of the Monday for the week containing the given date.
 * Weeks run Monday to Sunday.
 * @param {string} isoDate
 * @returns {string}
 */
function getWeekMonday(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const dayOfWeek = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setUTCDate(date.getUTCDate() - daysToSubtract);
  return date.toISOString().slice(0, 10);
}

/**
 * Formats a week label like "23 Mar – 29 Mar" or "30 Mar – 5 Apr".
 * @param {string} mondayIso
 * @param {string} sundayIso
 * @returns {string}
 */
function formatWeekLabel(mondayIso, sundayIso) {
  const monDay = parseInt(mondayIso.slice(8, 10), 10);
  const monMonth = MONTHS[parseInt(mondayIso.slice(5, 7), 10) - 1];
  const sunDay = parseInt(sundayIso.slice(8, 10), 10);
  const sunMonth = MONTHS[parseInt(sundayIso.slice(5, 7), 10) - 1];

  if (monMonth === sunMonth) {
    return `${monDay} – ${sunDay} ${sunMonth}`;
  }
  return `${monDay} ${monMonth} – ${sunDay} ${sunMonth}`;
}

/**
 * Groups timeline days into weeks (Monday–Sunday) and computes weekly totals.
 * @param {TimelineDay[]} timelineDays - sorted by date ascending
 * @returns {WeekGroup[]}
 */
function buildWeekGroups(timelineDays) {
  if (timelineDays.length === 0) return [];

  /** @type {{ monday: string, days: TimelineDay[] }[]} */
  const groups = [];
  /** @type {{ monday: string, days: TimelineDay[] } | null} */
  let current = null;

  for (const day of timelineDays) {
    const monday = getWeekMonday(day.date);
    if (!current || current.monday !== monday) {
      current = { monday, days: [] };
      groups.push(current);
    }
    current.days.push(day);
  }

  return groups.map((g) => {
    const sunday = addIsoDays(g.monday, 6);
    const totalMinutes = g.days.reduce((sum, d) => sum + computeDayMinutes(d), 0);
    return {
      weekLabel: formatWeekLabel(g.monday, sunday),
      days: g.days,
      totalFormatted: totalMinutes > 0 ? formatDuration(totalMinutes) : "",
    };
  });
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
    .sort((left, right) => getTimecardIsoDate(right, referenceDate).localeCompare(getTimecardIsoDate(left, referenceDate)))
    .map((entry) => ({
      dateLabel: formatIsoDate(getTimecardIsoDate(entry, referenceDate), entry.day),
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
    const timeRange = formatShiftTimeRange(shift);
    const { shiftType, isNonStandard } = classifyShift(timeRange, shift.off);
    dayMap.set(shift.date, {
      date: shift.date,
      dateLabel: formatIsoDate(shift.date, shift.day),
      isToday: shift.date === todayIso,
      isPast: shift.date < todayIso,
      timeRange,
      breakLabel: formatBreakLabel(shift.segments),
      note: shift.note,
      punches: null,
      total: null,
      scrapedTotal: null,
      calculatedTotal: null,
      payCode: null,
      shiftType,
      isNonStandard,
    });
  }

  // Merge timecard entries
  for (const entry of input.timecard?.entries ?? []) {
    const isoDate = getTimecardIsoDate(entry, referenceDate);
    const existing = dayMap.get(isoDate);
    const punches = formatPunches(entry);
    const scrapedTotal = entry.dailyTotal ?? entry.shiftTotal ?? null;
    const calculatedTotal = calculatePunchTotal(entry);
    const total = scrapedTotal;
    const payCode = entry.payCode ?? null;
    const timecardSchedule = entry.schedule ?? null;

    if (existing) {
      existing.punches = punches;
      existing.total = total;
      existing.scrapedTotal = scrapedTotal;
      existing.calculatedTotal = calculatedTotal;
      existing.payCode = payCode;
      if (!existing.timeRange && timecardSchedule) {
        existing.timeRange = timecardSchedule;
      }
    } else {
      const { shiftType, isNonStandard } = classifyShift(timecardSchedule, false);
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
        scrapedTotal,
        calculatedTotal,
        payCode,
        shiftType,
        isNonStandard,
      });
    }
  }

  // Fill every gap between the earliest and latest dates so free days are visible
  if (dayMap.size > 0) {
    const allDates = [...dayMap.keys()].sort();
    const earliest = allDates[0];
    const latest = allDates[allDates.length - 1];

    for (let isoDate = earliest; isoDate <= latest; isoDate = addIsoDays(isoDate, 1)) {
      if (dayMap.has(isoDate)) {
        continue;
      }

      const day = getIsoDayName(isoDate);
      dayMap.set(isoDate, {
        date: isoDate,
        dateLabel: formatIsoDate(isoDate, day),
        isToday: isoDate === todayIso,
        isPast: isoDate < todayIso,
        timeRange: null,
        breakLabel: null,
        note: null,
        punches: null,
        total: null,
        scrapedTotal: null,
        calculatedTotal: null,
        payCode: null,
        shiftType: null,
        isNonStandard: false,
      });
    }
  }

  const timelineDays = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const weekGroups = buildWeekGroups(timelineDays);
  const calculatedMinutes = (input.timecard?.entries ?? []).reduce((sum, entry) => {
    const minutes = parseDuration(calculatePunchTotal(entry));
    return sum + (minutes ?? 0);
  }, 0);

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
      scrapedHours: formatDuration(totalMinutes),
      calculatedHours: formatDuration(calculatedMinutes),
      period: input.timecard?.period ?? null,
    },
    upcomingShifts,
    recentEntries,
    timelineDays,
    weekGroups,
    issues,
  };
}

export { buildWebsiteViewModel, classifyShift, computeDayMinutes };
