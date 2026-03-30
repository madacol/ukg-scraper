import fs from "fs";
import path from "path";

const WEBSITE_TIMECARD_FILE = "timecard-website.json";

/**
 * Resolve a DD/MM date string to an ISO date using the reference date's year.
 * Handles the Dec -> Jan boundary for snapshots taken in January.
 * @param {string} ddmm
 * @param {string} referenceIso
 * @returns {string}
 */
function resolveDdmmIso(ddmm, referenceIso) {
  const [dayText, monthText] = ddmm.split("/").map(Number);
  let year = parseInt(referenceIso.slice(0, 4), 10);
  const referenceMonth = parseInt(referenceIso.slice(5, 7), 10);

  if (monthText === 12 && referenceMonth === 1) {
    year -= 1;
  }

  return `${year}-${String(monthText).padStart(2, "0")}-${String(dayText).padStart(2, "0")}`;
}

/**
 * Return an ISO date offset by N days.
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
 * Build website-friendly timecard data for a rolling window using archived
 * daily snapshots. The newest snapshot wins when the same date appears more
 * than once.
 * @param {{
 *   dataDir: string,
 *   todayIso?: string,
 *   windowDays?: number,
 * }} input
 * @returns {{ extractedAt: string, period: string, entries: object[] } | null}
 */
function buildWebsiteTimecardData(input) {
  const todayIso = input.todayIso ?? new Date().toISOString().slice(0, 10);
  const windowDays = input.windowDays ?? 30;
  const cutoffIso = addIsoDays(todayIso, -(windowDays - 1));

  if (!fs.existsSync(input.dataDir)) {
    return null;
  }

  const archiveFiles = fs.readdirSync(input.dataDir)
    .filter((name) => /^timecard-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();

  /** @type {Map<string, { extractedAt: string, entry: object }>} */
  const entriesByIso = new Map();
  let latestExtractedAt = null;

  for (const fileName of archiveFiles) {
    const filePath = path.join(input.dataDir, fileName);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const fileDate = fileName.match(/^timecard-(\d{4}-\d{2}-\d{2})\.json$/)?.[1] ?? todayIso;
    const extractedAt = typeof parsed.extractedAt === "string"
      ? parsed.extractedAt
      : `${fileDate}T00:00:00.000Z`;
    const referenceIso = extractedAt.slice(0, 10);

    if (!Array.isArray(parsed.entries)) {
      continue;
    }

    if (!latestExtractedAt || extractedAt > latestExtractedAt) {
      latestExtractedAt = extractedAt;
    }

    for (const entry of parsed.entries) {
      if (!entry || typeof entry.date !== "string") {
        continue;
      }

      const isoDate = resolveDdmmIso(entry.date, referenceIso);
      if (isoDate < cutoffIso || isoDate > todayIso) {
        continue;
      }

      const existing = entriesByIso.get(isoDate);
      if (!existing || extractedAt >= existing.extractedAt) {
        entriesByIso.set(isoDate, { extractedAt, entry });
      }
    }
  }

  if (!latestExtractedAt || entriesByIso.size === 0) {
    return null;
  }

  const entries = [...entriesByIso.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([, value]) => value.entry);

  return {
    extractedAt: latestExtractedAt,
    period: `Last ${windowDays} Days`,
    entries,
  };
}

/**
 * Save the derived website timecard dataset.
 * @param {string} dataDir
 * @param {{ extractedAt: string, period: string, entries: object[] }} data
 * @returns {string}
 */
function saveWebsiteTimecardData(dataDir, data) {
  fs.mkdirSync(dataDir, { recursive: true });
  const outputPath = path.join(dataDir, WEBSITE_TIMECARD_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  return outputPath;
}

export { WEBSITE_TIMECARD_FILE, buildWebsiteTimecardData, saveWebsiteTimecardData };
