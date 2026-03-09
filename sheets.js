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
 * Fetch raw weight data from Google Sheets
 * 
 * Only reads columns A and B (date and daily weight). All other metrics
 * (weekly average, weekly change, rate, on-target) are calculated by the
 * script rather than relying on spreadsheet formulas.
 * 
 * Why: Your Google Sheet requires manual formula copying every Monday.
 * By calculating in code, the sheet stays simple (just dates and weights)
 * and the math is automated, testable, and version-controlled.
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

  // Parse raw data — we only need date and daily weight from the sheet
  // Body fat and waist are kept if present since they come from DEXA/manual entry
  const rawEntries = dataRows
    .filter(row => row[0] && row[1])
    .map(row => ({
      date: normalizeDate(row[0]),
      dailyWeight: parseFloat(row[1]) || null,
      bodyFat: row[4] ? parseFloat(row[4]) : null,
      waist: row[5] ? parseFloat(row[5]) : null,
    }))
    .filter(entry => entry.date && entry.dailyWeight);

  // Now calculate all derived metrics from the raw daily weights
  return enrichWithCalculations(rawEntries);
}

/**
 * Calculate 7-day rolling averages and weekly changes
 * 
 * How it works:
 * For each day, we look back at the last 7 days of weigh-ins and take
 * the average. This smooths out daily fluctuations (water, sodium, food
 * volume) and reveals the actual trend.
 * 
 * The weekly change is the difference between this week's rolling average
 * and last week's. A negative value means you're losing weight.
 * 
 * Example:
 *   Day 1-7 weights: [68.0, 68.3, 67.8, 68.1, 67.9, 68.2, 67.7]
 *   Rolling avg on day 7: 68.0 kg
 *   
 *   Day 8-14 weights: [67.5, 67.8, 67.3, 67.6, 67.4, 67.7, 67.2]
 *   Rolling avg on day 14: 67.5 kg
 *   
 *   Weekly change: 67.5 - 68.0 = -0.5 kg (losing 0.5 kg/week — on target!)
 */
function enrichWithCalculations(entries) {
  return entries.map((entry, index) => {
    // Collect up to 7 days of weights ending at this entry
    // We look backwards from the current index
    const windowStart = Math.max(0, index - 6); // 6 + current = 7 days
    const window = entries.slice(windowStart, index + 1);
    const weights = window.map(e => e.dailyWeight).filter(w => w !== null);

    // Calculate rolling 7-day average
    // Need at least 3 data points for a meaningful average
    // (some days might be missing if you didn't weigh in)
    const weeklyAvg = weights.length >= 3
      ? Math.round((weights.reduce((sum, w) => sum + w, 0) / weights.length) * 100) / 100
      : null;

    // Calculate weekly change by comparing current rolling avg
    // to the rolling avg from 7 days ago
    let weeklyChange = null;
    let ratePct = null;
    let onTarget = null;

    if (weeklyAvg && index >= 7) {
      // Get the rolling average from 7 entries ago
      const prevIndex = index - 7;
      const prevWindowStart = Math.max(0, prevIndex - 6);
      const prevWindow = entries.slice(prevWindowStart, prevIndex + 1);
      const prevWeights = prevWindow.map(e => e.dailyWeight).filter(w => w !== null);

      if (prevWeights.length >= 3) {
        const prevAvg = prevWeights.reduce((sum, w) => sum + w, 0) / prevWeights.length;
        weeklyChange = Math.round((weeklyAvg - prevAvg) * 100) / 100;

        // Rate as percentage of bodyweight
        // Negative = losing weight (good during a cut)
        ratePct = Math.round((weeklyChange / prevAvg) * 10000) / 100;

        // On target: losing 0.2-0.6 kg/week
        // (weeklyChange is negative during a cut, so we check the absolute value)
        const lossRate = Math.abs(weeklyChange);
        onTarget = lossRate >= 0.2 && lossRate <= 0.6;
      }
    }

    return {
      ...entry,
      weeklyAvg,
      weeklyChange,
      ratePct,
      onTarget,
    };
  });
}

/**
 * Get recent weight data (last N days)
 * 
 * Fetches all weight data, calculates rolling averages across
 * the full dataset (so the first few days of your range still
 * have accurate averages), then returns only the last N entries.
 */
async function getRecentWeightData(days = 30) {
  // Fetch ALL data so rolling averages are calculated correctly
  // even for the first entries in your requested range.
  // Without this, the first 7 days would have no weekly average.
  const allData = await getWeightData('Weight!A:F');

  if (days && allData.length > days) {
    return allData.slice(-days);
  }
  return allData;
}

/**
 * Calculate rate metrics for a given week's data
 * (kept for backwards compatibility, but enrichWithCalculations
 * now handles this automatically)
 */
function calculateMetrics(currentWeekAvg, prevWeekAvg, bodyweight) {
  if (!currentWeekAvg || !prevWeekAvg) return null;

  const weeklyChange = currentWeekAvg - prevWeekAvg;
  const ratePct = (weeklyChange / prevWeekAvg) * 100;
  const rateKg = Math.abs(weeklyChange);
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