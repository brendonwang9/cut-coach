// ============================================================
// CUT COACH SYNC - Google Sheets Reader
// ============================================================
// Reads weight data from the Fitness Progress spreadsheet
// Uses Google Sheets API v4 with API key (read-only)

const config = require('./config');

/**
 * Fetch weight data from Google Sheets
 * @param {string} range - Sheet range e.g. 'Weight!A:F'
 * Returns array of { date, dailyWeight, weeklyAvg, weeklyChange, bodyFat, waist }
 */
async function getWeightData(range = '2026!A1299:F1400') {
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
 */
async function getRecentWeightData(days = 30) {
  // Calculate the approximate row range based on the sheet structure
  // The sheet starts at row 1299 for 2026-01-19
  // We want the most recent data
  const data = await getWeightData('2026!A1299:F1400');

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
