/**
 * @typedef {"Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun"} DayName
 */

/**
 * @typedef {{ start: string, end: string }} ShiftSegment
 */

/**
 * @typedef {Object} Shift
 * @property {string} date - ISO date string (YYYY-MM-DD)
 * @property {DayName} day
 * @property {string | null} start - Start time (H:MM) or null (first segment start)
 * @property {string | null} end - End time (H:MM) or null (last segment end)
 * @property {boolean} off
 * @property {string | null} note
 * @property {ShiftSegment[]} segments - Schedule segments (multiple when break is scheduled)
 */

/**
 * @typedef {Object} ApiSegment
 * @property {string} startDateTime - ISO datetime (YYYY-MM-DDTHH:MM:SS)
 * @property {string} endDateTime - ISO datetime (YYYY-MM-DDTHH:MM:SS)
 * @property {string} type - "REGULAR_SEGMENT" or "BREAK_SEGMENT"
 */

/**
 * @typedef {Object} RegularShift
 * @property {string} startDateTime - ISO datetime (YYYY-MM-DDTHH:MM:SS)
 * @property {string} endDateTime - ISO datetime (YYYY-MM-DDTHH:MM:SS)
 * @property {ApiSegment[]} [segments] - Inner segments (regular + break)
 */

/**
 * @typedef {Object} HolidayEntry
 * @property {string} displayName
 */

/**
 * @typedef {Object} HolidayListItem
 * @property {string} date - ISO date (YYYY-MM-DD)
 * @property {HolidayEntry[]} holidays
 */

/**
 * @typedef {Object} TimeOffPeriod
 * @property {string} startDate - ISO date (YYYY-MM-DD)
 */

/**
 * @typedef {Object} TimeOffRequest
 * @property {{ localizedName: string }} requestSubType
 * @property {{ name: string }} currentStatus
 * @property {TimeOffPeriod[]} periods
 */

/**
 * @typedef {Object} ScheduleApiResponse
 * @property {RegularShift[]} [regularShifts]
 * @property {HolidayListItem[]} [holidayList]
 * @property {TimeOffRequest[]} [timeOffRequests]
 */

/** @type {readonly ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]} */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Format a Date as an ISO date string (YYYY-MM-DD).
 * @param {Date} d
 * @returns {string}
 */
function formatDate(d) {
  return d.toISOString().split("T")[0];
}

/**
 * Return a new Date that is `n` days after `d`. Does not mutate `d`.
 * @param {Date} d
 * @param {number} n
 * @returns {Date}
 */
function addDays(d, n) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

/**
 * Format an hour:minute time string without leading zero on the hour.
 * @param {string} isoDateTime - e.g. "2026-02-21T09:00:00"
 * @returns {string} - e.g. "9:00"
 */
function formatTime(isoDateTime) {
  const timePart = isoDateTime.split("T")[1];
  const [hh, mm] = timePart.split(":");
  return `${parseInt(hh)}:${mm}`;
}

/**
 * Get the short day name for an ISO date string.
 * @param {string} dateStr - ISO date (YYYY-MM-DD)
 * @returns {DayName}
 */
function dayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return /** @type {DayName} */ (DAY_NAMES[d.getDay()]);
}

/**
 * Parse "H:MM" into total minutes for numeric comparison.
 * @param {string} hhmm
 * @returns {number}
 */
function parseHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Convert a UKG schedule API response into a sorted array of Shift objects.
 * @param {ScheduleApiResponse} apiResponse
 * @returns {Shift[]}
 */
function mapApiToShifts(apiResponse) {
  const regularShifts = apiResponse.regularShifts || [];
  const holidayList = apiResponse.holidayList || [];
  const timeOffRequests = apiResponse.timeOffRequests || [];

  /** @type {Map<string, Shift>} */
  const shiftsByDate = new Map();

  // Map regular shifts, extracting inner REGULAR_SEGMENT entries
  for (const rs of regularShifts) {
    const date = rs.startDateTime.split("T")[0];
    const innerSegments = (rs.segments || [])
      .filter((seg) => seg.type === "REGULAR_SEGMENT")
      .map((seg) => ({ start: formatTime(seg.startDateTime), end: formatTime(seg.endDateTime) }))
      .sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
    // Fall back to outer start/end if no inner segments
    const segments = innerSegments.length > 0
      ? innerSegments
      : [{ start: formatTime(rs.startDateTime), end: formatTime(rs.endDateTime) }];
    shiftsByDate.set(date, {
      date,
      day: dayOfWeek(date),
      start: segments[0].start,
      end: segments[segments.length - 1].end,
      off: false,
      note: null,
      segments,
    });
  }

  // Map holidays (only add if no regular shift on that date; annotate if shift exists)
  for (const item of holidayList) {
    const date = item.date;
    const name = item.holidays?.[0]?.displayName || "Holiday";
    const existing = shiftsByDate.get(date);
    if (existing) {
      existing.note = name;
    } else {
      shiftsByDate.set(date, {
        date,
        day: dayOfWeek(date),
        start: null,
        end: null,
        off: true,
        note: name,
        segments: [],
      });
    }
  }

  // Map time-off requests
  for (const tor of timeOffRequests) {
    const label = tor.requestSubType.localizedName;
    const status = tor.currentStatus.name;
    const note = `${label} (${status})`;
    for (const period of tor.periods) {
      const date = period.startDate;
      if (!shiftsByDate.has(date)) {
        shiftsByDate.set(date, {
          date,
          day: dayOfWeek(date),
          start: null,
          end: null,
          off: true,
          note,
          segments: [],
        });
      }
    }
  }

  return [...shiftsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export { formatDate, addDays, mapApiToShifts };
