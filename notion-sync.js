// ============================================================
// CUT COACH SYNC - Notion Database Writer
// ============================================================
// Pushes parsed JEFIT and weight data into Notion databases

const { Client } = require('@notionhq/client');
const config = require('./config');

const notion = new Client({ auth: config.notion.apiKey });

// ---- WORKOUTS DATABASE ----

/**
 * Check if a session already exists in Notion (by Session ID)
 */
async function workoutExists(sessionId) {
  const resp = await notion.databases.query({
    database_id: config.notion.databases.workouts,
    filter: {
      property: 'Session ID',
      rich_text: { equals: String(sessionId) },
    },
    page_size: 1,
  });
  return resp.results.length > 0 ? resp.results[0].id : null;
}

/**
 * Create a workout entry in Notion
 * Returns the page ID for linking exercise logs
 */
async function createWorkout(workout) {
  const existing = await workoutExists(workout.sessionId);
  if (existing) {
    console.log(`  Workout ${workout.date} already exists, skipping`);
    return existing;
  }

  const page = await notion.pages.create({
    parent: { database_id: config.notion.databases.workouts },
    properties: {
      'Session': { title: [{ text: { content: `${workout.date} Session` } }] },
      'Date': { date: { start: workout.date } },
      'Session ID': { rich_text: [{ text: { content: String(workout.sessionId) } }] },
      'Exercises': { number: workout.exerciseCount },
      'Total Volume (kg)': { number: workout.totalVolume },
      'Duration (min)': { number: workout.durationMin },
      'Records Broken': { number: workout.recordsBroken },
      'Status': { select: { name: 'Complete' } },
    },
  });

  console.log(`  ✅ Created workout: ${workout.date} (${workout.exerciseCount} exercises, ${workout.totalVolume}kg)`);
  return page.id;
}

// ---- EXERCISE LOGS DATABASE ----

/**
 * Check if an exercise log already exists (by Exercise ID + Date)
 */
async function exerciseLogExists(exerciseId, date) {
  const resp = await notion.databases.query({
    database_id: config.notion.databases.exerciseLogs,
    filter: {
      and: [
        { property: 'Exercise ID', rich_text: { equals: exerciseId } },
        { property: 'Date', date: { equals: date } },
      ],
    },
    page_size: 1,
  });
  return resp.results.length > 0;
}

/**
 * Create an exercise log entry linked to a workout session
 */
async function createExerciseLog(exercise, workoutPageId) {
  const existing = await exerciseLogExists(exercise.exerciseId, exercise.date);
  if (existing) return;

  const properties = {
    'Exercise Name': { title: [{ text: { content: exercise.exerciseName } }] },
    'Date': { date: { start: exercise.date } },
    'Exercise ID': { rich_text: [{ text: { content: exercise.exerciseId } }] },
    'Sets': { number: exercise.sets },
    'Best Set Weight (kg)': { number: exercise.bestSetWeight },
    'Best Set Reps': { number: exercise.bestSetReps },
    'Total Reps': { number: exercise.totalReps },
    'Estimated 1RM': { number: exercise.estimated1RM },
  };

  // Add body parts if available
  if (exercise.bodyParts && exercise.bodyParts.length > 0) {
    properties['Body Part'] = {
      multi_select: exercise.bodyParts.map(bp => ({ name: bp })),
    };
  }

  // Link to workout session
  if (workoutPageId) {
    properties['Session'] = {
      relation: [{ id: workoutPageId }],
    };
  }

  await notion.pages.create({
    parent: { database_id: config.notion.databases.exerciseLogs },
    properties,
  });

  console.log(`    📊 ${exercise.exerciseName}: ${exercise.bestSetWeight}kg x ${exercise.bestSetReps} (1RM: ${exercise.estimated1RM})`);
}

// ---- BODY METRICS DATABASE ----

/**
 * Check if a body metric entry already exists for a date
 */
async function bodyMetricExists(date) {
  const resp = await notion.databases.query({
    database_id: config.notion.databases.bodyMetrics,
    filter: {
      property: 'Date',
      date: { equals: date },
    },
    page_size: 1,
  });
  return resp.results.length > 0 ? resp.results[0].id : null;
}

/**
 * Create or update a body metric entry
 */
async function upsertBodyMetric(metric) {
  const existing = await bodyMetricExists(metric.date);

  const properties = {
    'Date Label': { title: [{ text: { content: metric.date } }] },
    'Date': { date: { start: metric.date } },
    'Daily Weight (kg)': { number: metric.dailyWeight },
  };

  if (metric.weeklyAvg) properties['Weekly Average (kg)'] = { number: metric.weeklyAvg };
  if (metric.weeklyChange) properties['Weekly Change (kg)'] = { number: metric.weeklyChange };
  if (metric.bodyFat) properties['Est Body Fat %'] = { number: metric.bodyFat };
  if (metric.waist) properties['Waist (cm)'] = { number: metric.waist };
  if (metric.ratePct) properties['Rate (% BW/week)'] = { number: metric.ratePct };
  if (metric.onTarget !== undefined) properties['On Target'] = { checkbox: metric.onTarget };

  if (existing) {
    await notion.pages.update({ page_id: existing, properties });
    console.log(`  ⚖️ Updated: ${metric.date} - ${metric.dailyWeight}kg`);
  } else {
    await notion.pages.create({
      parent: { database_id: config.notion.databases.bodyMetrics },
      properties,
    });
    console.log(`  ⚖️ Created: ${metric.date} - ${metric.dailyWeight}kg`);
  }
}

// ---- ALERTS DATABASE ----

/**
 * Create an alert entry
 */
async function createAlert({ level, category, summary, dataSnapshot }) {
  const today = new Date().toISOString().split('T')[0];

  await notion.pages.create({
    parent: { database_id: config.notion.databases.alerts },
    properties: {
      'Summary': { title: [{ text: { content: summary } }] },
      'Date': { date: { start: today } },
      'Alert Level': { select: { name: level } },
      'Category': { select: { name: category } },
      'Data Snapshot': { rich_text: [{ text: { content: JSON.stringify(dataSnapshot).substring(0, 2000) } }] },
      'Action Taken': { select: { name: 'Pending' } },
      'Sent to Telegram': { checkbox: false },
    },
  });

  console.log(`  🚨 Alert [${level}] ${category}: ${summary}`);
}

// ---- QUERY HELPERS (for analysis) ----

/**
 * Get recent exercise logs for a specific exercise
 */
async function getRecentExerciseLogs(exerciseName, limit = 10) {
  const resp = await notion.databases.query({
    database_id: config.notion.databases.exerciseLogs,
    filter: {
      property: 'Exercise Name',
      title: { equals: exerciseName },
    },
    sorts: [{ property: 'Date', direction: 'descending' }],
    page_size: limit,
  });

  return resp.results.map(page => ({
    date: page.properties['Date']?.date?.start,
    weight: page.properties['Best Set Weight (kg)']?.number,
    reps: page.properties['Best Set Reps']?.number,
    estimated1RM: page.properties['Estimated 1RM']?.number,
  }));
}

/**
 * Get recent body metrics
 */
async function getRecentBodyMetrics(limit = 14) {
  const resp = await notion.databases.query({
    database_id: config.notion.databases.bodyMetrics,
    sorts: [{ property: 'Date', direction: 'descending' }],
    page_size: limit,
  });

  return resp.results.map(page => ({
    date: page.properties['Date']?.date?.start,
    weight: page.properties['Daily Weight (kg)']?.number,
    weeklyAvg: page.properties['Weekly Average (kg)']?.number,
    weeklyChange: page.properties['Weekly Change (kg)']?.number,
  }));
}

module.exports = {
  workoutExists,
  createWorkout,
  exerciseLogExists,
  createExerciseLog,
  bodyMetricExists,
  upsertBodyMetric,
  createAlert,
  getRecentExerciseLogs,
  getRecentBodyMetrics,
};
