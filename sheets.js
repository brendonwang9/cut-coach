// ============================================================
// CUT COACH SYNC - Google Sheets Reader
// ============================================================
// Reads weight data from the Fitness Progress spreadsheet
// Uses Google Sheets API v4 with API key (read-only)

const config = require('./config');

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
      date: row[0],                              // Column A: Date (YYYY-MM-DD)
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