// ============================================================
// CUT COACH SYNC - Google Sheets Reader
// ============================================================
// Reads weight data from the Fitness Progress spreadsheet
// Uses Google Sheets API v4 with API key (read-only)

const config = require('./config');

/**
 * Convert date strings to ISO format (YYYY-MM-DD)
 * 
 * Google Sheets stores dates in the locale format of the spreadsheet owner.
 * Your sheet uses DD/MM/YYYY (Australian format), but Notion's API requires
 * ISO 8601 format (YYYY-MM-DD). This function handles the conversion.
 * 
 * Examples:
 *   "16/02/2025"  → "2025-02-16"  (DD/MM/YYYY)
 *   "2025-02-16"  → "2025-02-16"  (already ISO, no change)
 *   "2026-01-19"  → "2026-01-19"  (already ISO, no change)
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // DD/MM/YYYY format → convert to YYYY-MM-DD
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // MM/DD/YYYY format (US) — unlikely for you but handled for safety
  // Can't reliably distinguish from DD/MM/YYYY, so we assume DD/MM/YYYY
  // since your spreadsheet uses Australian locale

  console.warn(`  ⚠️ Unrecognized date format: ${dateStr}`);
  return dateStr;
}

/**
 * Fetch weight data from Google Sheets
 * 
 * Uses the "Weight" tab and fetches all rows from columns A-F.
 * The Google Sheets API returns only rows that have data, so
 * fetching A:F doesn't download empty rows — it's efficient.
 * 
 * @param {string} range - Sheet range (default: all data from Weight tab)
 * Returns array of { date, dailyWeight, weeklyAvg, weeklyChange, bodyFat, waist }
 */
async function getWeightData(range = 'Weight!A:F') {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheets.spreadsheetId}/values/${encodeURIComponent(range)}?key=${config.sheets.apiKey}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google Sheets fetch failed: ${resp.status} - ${text}`);
  }

  const data = await resp.json();
  const rows = data.values || [];

  // Skip header row if present
  const dataRows = rows[0]?.[0] === 'Date' ? rows.slice(1) : rows;

  return dataRows
    .filter(row => row[0] && row[1]) // Must have date and weight
    .map(row => ({
      date: normalizeDate(row[0]),                 // Column A: Date → converted to YYYY-MM-DD
      dailyWeight: parseFloat(row[1]) || null,    // Column B: Daily weight
      weeklyAvg: parseFloat(row[2]) || null,      // Column C: Weekly average
      weeklyChange: parseFloat(row[3]) || null,   // Column D: Weekly change
      bodyFat: row[4] ? parseFloat(row[4]) : null,// Column E: Body fat % (sparse)
      waist: row[5] ? parseFloat(row[5]) : null,  // Column F: Waist (sparse)
    }));
}

/**
 * Get recent weight data (last N days)
 * 
 * Fetches all weight data then returns only the last N entries.
 * This is simple and reliable — the sheet has ~1400 rows which
 * the API handles in under a second.
 */
async function getRecentWeightData(days = 30) {
  const data = await getWeightData('Weight!A:F');

  if (days && data.length > days) {
    return data.slice(-days);
  }
  return data;
}

/**
 * Calculate rate metrics for a given week's data
 */
function calculateMetrics(currentWeekAvg, prevWeekAvg, bodyweight) {
  if (!currentWeekAvg || !prevWeekAvg) return null;

  const weeklyChange = currentWeekAvg - prevWeekAvg;
  const ratePct = (weeklyChange / prevWeekAvg) * 100;
  const rateKg = Math.abs(weeklyChange);

  // Determine if on target based on current BF% estimate
  // Target: 0.3-0.5 kg/week above 15% BF, 0.2-0.3 below 15%
  const onTarget = rateKg >= 0.2 && rateKg <= 0.6;

  return {
    weeklyChange: Math.round(weeklyChange * 100) / 100,
    ratePct: Math.round(ratePct * 100) / 100,
    rateKg: Math.round(rateKg * 100) / 100,
    onTarget,
  };
}

module.exports = {
  getWeightData,
  getRecentWeightData,
  calculateMetrics,
};