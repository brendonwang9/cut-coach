// ============================================================
// CUT COACH SYNC - JEFIT API Client
// ============================================================
// Interfaces with JEFIT's internal REST API (undocumented)
// Authentication: uses session cookie from browser login

const config = require('./config');

const headers = {
  'Content-Type': 'application/json',
  'Cookie': config.jefit.sessionCookie,
};

// Exercise name cache to avoid repeated API calls
const exerciseCache = new Map();

/**
 * Fetch all workout dates from JEFIT calendar
 * Returns array of { date, has_logs, has_notes, has_photos, has_body_stats }
 */
async function getCalendar() {
  const url = `${config.jefit.baseUrl}/users/${config.jefit.userId}/sessions/calendar?timezone_offset=${config.sync.timezoneOffset}`;
  const resp = await fetch(url, { headers });
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
  const resp = await fetch(url, { headers });
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
  const resp = await fetch(url, { headers });
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
};
