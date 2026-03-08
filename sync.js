#!/usr/bin/env node
// ============================================================
// CUT COACH SYNC - Main Orchestrator
// ============================================================
// Usage:
//   node sync.js                    # Sync last 7 days
//   node sync.js --days 30          # Sync last 30 days
//   node sync.js --backfill         # Sync last 90 days (initial setup)
//   node sync.js --workouts-only    # Only sync JEFIT workouts
//   node sync.js --weight-only      # Only sync weight data

const jefit = require('./jefit');
const sheets = require('./sheets');
const notionSync = require('./notion-sync');

// ---- CLI ARGS ----
const args = process.argv.slice(2);
const flags = {
  days: parseInt(args.find((_, i) => args[i - 1] === '--days') || '7'),
  backfill: args.includes('--backfill'),
  workoutsOnly: args.includes('--workouts-only'),
  weightOnly: args.includes('--weight-only'),
};
if (flags.backfill) flags.days = 90;

// ---- HELPERS ----
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- SYNC WORKOUTS ----
async function syncWorkouts(startDate, endDate) {
  console.log(`\n💪 Syncing workouts: ${startDate} → ${endDate}`);

  // Get all dates that have workout logs
  const workoutDates = await jefit.getWorkoutDates(startDate, endDate);
  console.log(`  Found ${workoutDates.length} workout days`);

  let synced = 0;
  let skipped = 0;

  for (const date of workoutDates) {
    const unixTs = jefit.dateToUnix(date);
    const sessions = await jefit.getSessions(unixTs);

    for (const session of sessions) {
      const { workout, exercises } = await jefit.parseSession(session);

      // Create workout entry, get page ID for linking
      const workoutPageId = await notionSync.createWorkout(workout);

      // Create exercise log entries
      for (const exercise of exercises) {
        await notionSync.createExerciseLog(exercise, workoutPageId);
        await sleep(350); // Rate limit: Notion API allows ~3 requests/sec
      }

      synced++;
    }

    // Be nice to JEFIT's API
    await sleep(500);
  }

  console.log(`  ✅ Synced ${synced} sessions, ${skipped} skipped`);
  return synced;
}

// ---- SYNC WEIGHT ----
async function syncWeight(days) {
  console.log(`\n⚖️ Syncing weight data: last ${days} days`);

  const weightData = await sheets.getRecentWeightData(days);
  console.log(`  Found ${weightData.length} weight entries`);

  let synced = 0;

  for (const entry of weightData) {
    if (!entry.dailyWeight) continue;

    await notionSync.upsertBodyMetric(entry);
    synced++;
    await sleep(350); // Rate limit
  }

  console.log(`  ✅ Synced ${synced} weight entries`);
  return synced;
}

// ---- MAIN ----
async function main() {
  console.log('='.repeat(50));
  console.log('🏋️ CUT COACH SYNC');
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`  Range: ${flags.days} days back`);
  console.log('='.repeat(50));

  // Show token expiry status so you know when to refresh
  jefit.printTokenStatus();

  const startDate = daysAgo(flags.days);
  const endDate = new Date().toISOString().split('T')[0];

  try {
    if (!flags.weightOnly) {
      await syncWorkouts(startDate, endDate);
    }

    if (!flags.workoutsOnly) {
      await syncWeight(flags.days);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Sync complete!');
    console.log('='.repeat(50));

  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);

    if (error.message.includes('401') || error.message.includes('403')) {
      console.error('  → Authentication failed. Check your JEFIT session cookie or Notion API key.');
    }
    if (error.message.includes('rate_limited') || error.message.includes('429')) {
      console.error('  → Rate limited. Wait a minute and try again with fewer days.');
    }

    process.exit(1);
  }
}

main();
