// ============================================================
// CUT COACH SYNC - JEFIT API Client
// ============================================================
// Interfaces with JEFIT's internal REST API (undocumented)
// Authentication: JWT tokens with auto-refresh
//
// TOKEN LIFECYCLE:
//   accessToken  - expires every ~7 days, used for all API calls
//   refreshToken - expires every ~3 months, used to get new accessTokens
//
// The auto-refresh flow:
//   1. Script tries an API call with the accessToken
//   2. If it gets a 401 (expired), it calls JEFIT's auth endpoint
//      with the refreshToken to get a fresh accessToken
//   3. The new accessToken is saved to .env so it persists
//   4. The original API call is retried with the new token
//
// When the refreshToken itself expires (~3 months), you must:
//   1. Log into jefit.com in your browser
//   2. Copy fresh tokens from DevTools → Application → Cookies
//   3. Update .env with the new values
//
// The script will warn you 7 days before the refreshToken expires.

const fs = require('fs');
const path = require('path');
const config = require('./config');

// Exercise name cache to avoid repeated API calls
const exerciseCache = new Map();

// Token state - loaded from config, updated on refresh
let accessToken = config.jefit.accessToken;
let refreshToken = config.jefit.refreshToken;

/**
 * Decode a JWT token to read its payload (without verifying signature)
 * 
 * JWT tokens have 3 parts separated by dots: header.payload.signature
 * The payload is base64-encoded JSON containing claims like expiry time.
 * We don't need to verify the signature - JEFIT's server does that.
 * We just need to read the expiry time to know when to refresh.
 */
function decodeJWT(token) {
  try {
    const payload = token.split('.')[1];
    // JWT uses base64url encoding (slightly different from regular base64)
    // We need to convert it back to regular base64 before decoding
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString());
  } catch (e) {
    return null;
  }
}

/**
 * Check if a token is expired or about to expire
 * @param {string} token - JWT token string
 * @param {number} bufferSeconds - Consider expired this many seconds early (default: 60)
 */
function isTokenExpired(token, bufferSeconds = 60) {
  const payload = decodeJWT(token);
  if (!payload || !payload.exp) return true;
  // payload.exp is a Unix timestamp (seconds since Jan 1 1970)
  // Date.now() returns milliseconds, so we divide by 1000
  return (Date.now() / 1000) > (payload.exp - bufferSeconds);
}

/**
 * Check how many days until the refresh token expires
 * Used to warn you before it's too late
 */
function refreshTokenDaysRemaining() {
  const payload = decodeJWT(refreshToken);
  if (!payload || !payload.exp) return 0;
  const now = Date.now() / 1000;
  return Math.floor((payload.exp - now) / 86400); // 86400 seconds in a day
}

/**
 * Use the refresh token to get a new access token from JEFIT
 * 
 * This calls JEFIT's auth endpoint which:
 * - Validates the refresh token is still valid
 * - Returns a brand new access token (good for ~7 more days)
 * - May also return a new refresh token (extending the 3-month window)
 */
async function refreshAccessToken() {
  console.log('  🔄 Access token expired, refreshing...');

  const resp = await fetch(`${config.jefit.baseUrl}/auth/account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `jefitRefreshToken=${refreshToken}; jefitAccessToken=${accessToken}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
      const daysLeft = refreshTokenDaysRemaining();
      throw new Error(
        `JEFIT refresh token is expired or invalid. ` +
        `You need to log into jefit.com in your browser and copy fresh tokens to .env. ` +
        `(Refresh token had ${daysLeft} days remaining)`
      );
    }
    throw new Error(`JEFIT token refresh failed: ${resp.status} - ${text}`);
  }

  // Check response cookies for new tokens
  // The Set-Cookie header contains the new tokens
  const cookies = resp.headers.get('set-cookie') || '';
  
  const newAccessMatch = cookies.match(/jefitAccessToken=([^;]+)/);
  const newRefreshMatch = cookies.match(/jefitRefreshToken=([^;]+)/);

  if (newAccessMatch) {
    accessToken = newAccessMatch[1];
    console.log('  ✅ Got new access token');
  }
  if (newRefreshMatch) {
    refreshToken = newRefreshMatch[1];
    console.log('  ✅ Got new refresh token (3-month window extended)');
  }

  // Also try parsing the response body for tokens
  try {
    const data = await resp.json();
    if (data.accessToken) accessToken = data.accessToken;
    if (data.refreshToken) refreshToken = data.refreshToken;
  } catch (e) {
    // Response might not be JSON, that's fine
  }

  // Save updated tokens back to .env so they persist between runs
  // This is important: without this, you'd lose the refreshed token
  // when the script exits, and the next run would use the old expired one
  updateEnvFile();

  return accessToken;
}

/**
 * Update the .env file with current token values
 * 
 * This writes the new tokens back to disk so the next time
 * the script runs, it picks up the refreshed tokens automatically.
 * Without this step, auto-refresh would only work within a single
 * script execution - the next run would start with stale tokens.
 */
function updateEnvFile() {
  const envPath = path.join(__dirname, '.env');
  try {
    let content = fs.readFileSync(envPath, 'utf8');

    // Replace existing token values with new ones
    if (content.includes('JEFIT_ACCESS_TOKEN=')) {
      content = content.replace(
        /JEFIT_ACCESS_TOKEN=.*/,
        `JEFIT_ACCESS_TOKEN=${accessToken}`
      );
    }
    if (content.includes('JEFIT_REFRESH_TOKEN=')) {
      content = content.replace(
        /JEFIT_REFRESH_TOKEN=.*/,
        `JEFIT_REFRESH_TOKEN=${refreshToken}`
      );
    }

    fs.writeFileSync(envPath, content);
    console.log('  💾 Updated .env with fresh tokens');
  } catch (e) {
    // .env might not exist (using system env vars instead)
    console.warn('  ⚠️ Could not update .env file:', e.message);
  }
}

/**
 * Build auth headers with current access token
 */
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Cookie': `jefitAccessToken=${accessToken}; jefitRefreshToken=${refreshToken}`,
  };
}

/**
 * Make an authenticated API request with automatic token refresh
 * 
 * This is the core pattern: try the request, and if we get a 401
 * (which means the access token expired), refresh it and retry once.
 * If the retry also fails, the refresh token is probably dead too.
 */
async function authenticatedFetch(url, options = {}) {
  // First attempt
  let resp = await fetch(url, { ...options, headers: getHeaders() });

  // If unauthorized, try refreshing the token and retrying
  if (resp.status === 401) {
    await refreshAccessToken();
    // Retry with the new token
    resp = await fetch(url, { ...options, headers: getHeaders() });
  }

  return resp;
}

/**
 * Print token status at startup (helps you know when to refresh)
 */
function printTokenStatus() {
  const accessPayload = decodeJWT(accessToken);
  const refreshPayload = decodeJWT(refreshToken);

  if (accessPayload?.exp) {
    const accessDays = Math.floor((accessPayload.exp - Date.now() / 1000) / 86400);
    if (accessDays <= 0) {
      console.log('  🔑 Access token: expired (will auto-refresh)');
    } else {
      console.log(`  🔑 Access token: ${accessDays} days remaining`);
    }
  }

  if (refreshPayload?.exp) {
    const refreshDays = Math.floor((refreshPayload.exp - Date.now() / 1000) / 86400);
    if (refreshDays <= 7) {
      console.log(`  ⚠️  REFRESH TOKEN: only ${refreshDays} days remaining! Update soon.`);
      console.log('      → Log into jefit.com and copy fresh tokens to .env');
    } else if (refreshDays <= 14) {
      console.log(`  🔑 Refresh token: ${refreshDays} days remaining (update soon)`);
    } else {
      console.log(`  🔑 Refresh token: ${refreshDays} days remaining`);
    }
  }
}

/**
 * Fetch all workout dates from JEFIT calendar
 * Returns array of { date, has_logs, has_notes, has_photos, has_body_stats }
 */
async function getCalendar() {
  const url = `${config.jefit.baseUrl}/users/${config.jefit.userId}/sessions/calendar?timezone_offset=${config.sync.timezoneOffset}`;
  const resp = await authenticatedFetch(url);
  if (!resp.ok) throw new Error(`JEFIT calendar fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.data;
}

/**
 * Fetch session data for a specific date
 * @param {number} unixTimestamp - Start of day as unix timestamp
 * Returns array of session objects with full exercise logs
 */
async function getSessions(unixTimestamp) {
  const url = `${config.jefit.baseUrl}/users/${config.jefit.userId}/sessions?startDate=${unixTimestamp}`;
  const resp = await authenticatedFetch(url);
  if (!resp.ok) throw new Error(`JEFIT sessions fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.data || [];
}

/**
 * Fetch exercise metadata (name, body parts, equipment)
 * @param {string} exerciseId - e.g. 'd_000000000048'
 */
async function getExercise(exerciseId) {
  if (exerciseCache.has(exerciseId)) return exerciseCache.get(exerciseId);

  const url = `${config.jefit.baseUrl}/exercises/${exerciseId}`;
  const resp = await authenticatedFetch(url);
  if (!resp.ok) {
    console.warn(`Could not fetch exercise ${exerciseId}: ${resp.status}`);
    return { name: exerciseId, body_parts: ['unknown'] };
  }
  const data = await resp.json();
  const exercise = data.data;
  exerciseCache.set(exerciseId, exercise);
  return exercise;
}

/**
 * Parse a session into structured workout + exercise data
 */
async function parseSession(session) {
  const sessionDate = new Date(session.date * 1000);
  const dateStr = sessionDate.toISOString().split('T')[0];

  const workout = {
    sessionId: String(session.id || session.local_id),
    date: dateStr,
    exerciseCount: session.exercise_count || (session.logs ? session.logs.length : 0),
    totalVolume: Math.round(session.total_weight || 0),
    durationMin: Math.round((session.total_time || 0) / 60),
    recordsBroken: session.records_broken || 0,
  };

  const exercises = [];
  if (session.logs) {
    for (const log of session.logs) {
      const exerciseInfo = await getExercise(log.exercise_id);

      // Parse sets - weight is stored in lbs internally
      const sets = (log.log_sets || []).map(s => ({
        weight: Math.round((s.weight / 2.20462) * 100) / 100, // Convert lbs to kg
        reps: s.reps,
      }));

      const bestSet = sets.reduce((best, s) => s.weight > best.weight ? s : best, { weight: 0, reps: 0 });
      const totalReps = sets.reduce((sum, s) => sum + s.reps, 0);

      // Map body parts - filter out "none"
      const bodyParts = (exerciseInfo.body_parts || [])
        .filter(bp => bp && bp !== 'none')
        .map(bp => {
          // Normalize body part names to match Notion select options
          const mapping = {
            'chest': 'Chest',
            'back': 'Back',
            'shoulders': 'Shoulders',
            'biceps': 'Biceps',
            'triceps': 'Triceps',
            'quadriceps': 'Legs',
            'hamstrings': 'Legs',
            'glutes': 'Legs',
            'calves': 'Legs',
            'abs': 'Abs',
            'forearms': 'Forearms',
            'traps': 'Back',
            'lats': 'Back',
          };
          return mapping[bp.toLowerCase()] || bp;
        })
        .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

      exercises.push({
        date: dateStr,
        exerciseName: exerciseInfo.name || log.exercise_id,
        exerciseId: log.exercise_id,
        bodyParts,
        sets: sets.length,
        bestSetWeight: bestSet.weight,
        bestSetReps: bestSet.reps,
        totalReps,
        estimated1RM: log.record || 0,
      });
    }
  }

  return { workout, exercises };
}

/**
 * Get workout dates that have logs within a date range
 */
async function getWorkoutDates(startDate, endDate) {
  const calendar = await getCalendar();
  return calendar
    .filter(d => d.has_logs && d.date >= startDate && d.date <= endDate)
    .map(d => d.date);
}

/**
 * Convert a date string (YYYY-MM-DD) to unix timestamp for JEFIT API
 */
function dateToUnix(dateStr) {
  return Math.floor(new Date(dateStr + 'T00:00:00+11:00').getTime() / 1000);
}

module.exports = {
  getCalendar,
  getSessions,
  getExercise,
  parseSession,
  getWorkoutDates,
  dateToUnix,
  printTokenStatus,
};
