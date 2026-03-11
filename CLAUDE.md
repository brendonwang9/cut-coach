# Cut Coach — Project Specification

## What This Is

Cut Coach is a proactive AI monitoring system for body recomposition cuts. It syncs workout data from JEFIT and weight data from Google Sheets into Notion databases, where OpenClaw analyses trends and sends alerts via Telegram.

The system replaces emotional decision-making with data-driven frameworks. It is designed to be **opinionated and quiet** — it only speaks when something actually matters.

## Owner

Brendon Wang (@brendonwang9). Based in Sydney, Australia (AEST timezone).

## Current Cut Context

- Started cut at ~19.5% body fat (DEXA scan Feb 16, 2026)
- Target: 13-15% body fat
- Starting weight: ~69kg, currently ~67.5kg
- Rate target: 0.3-0.5 kg/week (adjusts to 0.2-0.3 below 15% BF)
- Protein: 150g/day, not tracking exact calories
- Training: 4-5x/week
- Scale data has 2-day lag from smart scale sync

## Architecture

```
JEFIT (workouts) ──┐
                   ├──→ Notion Databases ──→ OpenClaw (AI) ──→ Telegram
Google Sheets (weight) ┘      ↑
                              │
                        Claude / Claude Code (reads/writes)
```

### Deployment
The sync script runs on **Railway** as a cron job. Auto-deploys from GitHub on push to `main`.

- **Cron schedule**: `30 22 * * *` UTC = 9:30am AEDT daily
- **Config**: `railway.json` (cron schedule, no-restart policy, Nixpacks builder)
- **Env vars**: All credentials stored in Railway service variables (not `.env`)
- **CI/CD**: Push to `main` → Railway auto-builds and deploys → cron fires on schedule

### Data Flow
1. **Railway cron** triggers `node sync.js` daily at 9:30am AEDT
2. Sync script pulls from JEFIT API and Google Sheets, writes to 4 Notion databases
3. **OpenClaw** reads Notion on its own schedule, runs analysis, sends Telegram messages
4. **Claude/Claude Code** can read and modify any part of the system

### Components
| Component | Role | Location |
|---|---|---|
| Sync script | JEFIT + Sheets → Notion pipeline | This repo (`sync.js`), deployed on Railway |
| Notion databases | Central data hub | Brendon's Workspace → Cut Coach page |
| OpenClaw | AI analysis + Telegram delivery | Local machine (scheduled jobs) |
| Claude Code | Code changes, debugging, feature additions | This repo |

## Notion Databases

All four databases live under the "Cut Coach" page in Brendon's Notion workspace.

### 💪 Workouts (`1224293308dd46ef904212d29e141e04`)
One row per gym session. Fields: Date, Session ID, Exercises count, Total Volume (kg), Duration (min), Records Broken, Status.

### 📊 Exercise Logs (`0ba489f819af4109abf1f9281ba60680`)
One row per exercise per session. This is the critical database for strength tracking.
Fields: Exercise Name, Date, Exercise ID, Body Part (multi-select), Sets, Best Set Weight (kg), Best Set Reps, Total Reps, Estimated 1RM, Session (relation to Workouts).

### ⚖️ Body Metrics (`18c8a9a691324540ae20a0dc6d3532f0`)
One row per day. Fields: Date, Daily Weight (kg), Weekly Average (kg), Weekly Change (kg), Est Body Fat %, Waist (cm), Rate (% BW/week), On Target (checkbox).

Weekly Average, Weekly Change, Rate, and On Target are **calculated by the sync script** from raw daily weights (not from Google Sheets formulas).

### 🚨 Alerts & Analysis (`ea9b74179f6a4075a23084e08c9770bc`)
Alert history log. Fields: Summary, Date, Alert Level (Green/Yellow/Red/Info), Category, Data Snapshot, Action Taken, Sent to Telegram.

## JEFIT API

Undocumented internal REST API discovered via browser network analysis. User ID: `10835027`.

| Endpoint | Method | Returns |
|---|---|---|
| `/api/v2/users/{id}/sessions/calendar?timezone_offset=+11:00` | GET | All workout dates since Feb 2023 |
| `/api/v2/users/{id}/sessions?startDate={unix_ts}` | GET | Full session data: exercises, sets (weight in lbs internally), 1RM, volume, duration |
| `/api/v2/exercises/{exercise_id}` | GET | Exercise name, body_parts array, equipment |
| `/api/v2/users/{id}/exercises` | GET | Custom user exercises |

### Authentication
Uses JWT tokens sent as cookies (`jefitAccessToken` and `jefitRefreshToken`).
- Access token expires every ~7 days — **auto-refreshed by the script**
- Refresh token expires every ~3 months — requires manual browser login to renew
- On Railway: refreshed tokens are persisted via Railway's GraphQL API (updates service env vars)
- Locally: refreshed tokens are written back to `.env`

### Unit Conversion
- `log_sets[].weight` is stored in **pounds** internally. Convert: `kg = lbs / 2.20462`
- `session.total_weight` is already in kg (display unit)
- `log.record` (1RM) appears to be in kg

## Google Sheets

Spreadsheet ID: `1wqtSD9IpYRV-qsrj_5HNmqBHJrduFGeF6gtYmyTFPuI`
Tab: "Weight"
Columns: A (Date DD/MM/YYYY), B (Daily Weight kg), C-F (legacy formulas, ignored by script)

### Date Format
The sheet uses **DD/MM/YYYY** (Australian format). The sync script converts to ISO 8601 (YYYY-MM-DD) via `normalizeDate()` before writing to Notion.

### Scale Lag
Weight data has a **2-day lag** from smart scale sync. This is expected and doesn't affect weekly average calculations.

## Decision Frameworks

These frameworks are encoded in OpenClaw's system prompts for automated analysis.

### Weight Trajectory
- Track **weekly averages only**. Daily readings are noise.
- Target rate: 0.3-0.5 kg/week at 15-20% BF, slowing to 0.2-0.3 below 15%
- **Stall**: weekly average flat for 2+ consecutive weeks → suggest 100-150 kcal reduction
- **Rapid loss**: >0.7% BW/week for 2+ weeks → warn about muscle loss risk
- A few days of flat scale is NOT a stall

### Strength (Primary Muscle Retention Signal)
For each exercise, compare Estimated 1RM against trailing 3-session average:
- **GREEN**: 1RM maintained or improved → muscle being retained
- **YELLOW**: 1RM dropped 1-5% for 2-3 consecutive sessions → flag, check confounders
- **RED**: 1RM dropped >5% OR multiple exercises dropping simultaneously → deload trigger
- **Single session dip = NOISE. Never flag a single bad session.**

### Deload Trigger (Composite — need a cluster, not one signal)
- Multi-lift strength regression over 1+ week (40% weight)
- Sleep quality decline (20%)
- Training volume tolerance declining (15%)
- Session frequency dropping (15%)
- Subjective fatigue (10%)
- **Threshold**: composite score ≥70% → recommend deload

### Diet Break Trigger
Both conditions must be present simultaneously:
1. Weight loss stalled for 2+ weeks
2. Strength declining across multiple lifts over same period
If only one is present, the system advises patience or checks confounders.

### Contextual Intelligence
Before escalating any flag, check:
- Was sleep below baseline? → attribute strength dip to recovery, not muscle loss
- Travel or social event this week? → weight spike is likely water/sodium
- New exercise recently? → performance dip may be motor learning
- Approaching checkpoint date? → suppress minor alerts, bundle into checkpoint report

## OpenClaw Configuration

Two scheduled jobs:

### Weekly Digest (Monday 8am AEST)
Reads Exercise Logs, Body Metrics, and Workouts for the past 7-14 days. Sends a Telegram message with weight trend, strength status per exercise (green/yellow/red), training volume, and projection to goal. Under 300 words. See `openclaw-config.md` for full prompt.

### Daily Check (10am AEST)
Checks for RED-level conditions only. **If nothing is red, sends nothing.** Silence = green.
Three trigger conditions:
1. 3+ exercises showing >5% 1RM decline (multi-lift regression)
2. Weekly average rising for 2+ consecutive weeks (weight reversal)
3. Weight stalled 2+ weeks AND 2+ exercises declining (combined trigger → diet break)

## File Structure

```
cut-coach-sync/
├── config.js            # Configuration (reads from env vars, with .env fallback locally)
├── jefit.js             # JEFIT API client with JWT auto-refresh and Railway token persistence
├── sheets.js            # Google Sheets reader with date normalization and rolling average calculation
├── notion-sync.js       # Notion database writer (workouts, exercise logs, body metrics, alerts)
├── sync.js              # Main orchestrator — entry point for all sync operations
├── railway.json         # Railway deployment config (cron schedule, no-restart, Nixpacks)
├── openclaw-config.md   # System prompts for OpenClaw weekly digest and daily alert jobs
├── .env.example         # Template for credentials (local dev only)
├── .env                 # Actual credentials (gitignored, local only)
├── package.json         # Dependencies: @notionhq/client, dotenv
├── claude.md            # This file — project spec for AI tools
└── README.md            # User-facing documentation and commands
```

## Key Technical Decisions

1. **JEFIT internal API over scraping**: The web app calls a clean REST API under the hood. No DOM scraping needed. Discovered via network analysis.

2. **Weekly averages calculated in code, not Google Sheets**: Eliminates manual formula copying. The sync script computes 7-day rolling averages from raw daily weights.

3. **Separate Workouts and Exercise Logs databases**: Workouts is session-level (one row per gym visit). Exercise Logs is exercise-level (one row per exercise per session). The exercise-level granularity is required for strength regression detection — comparing bench press 1RM across sessions requires filtering by exercise.

4. **Idempotent sync**: All sync operations check for existing entries before creating. Running the same sync twice produces no duplicates. Workouts deduplicate on Session ID. Exercise Logs deduplicate on Exercise ID + Date. Body Metrics upsert on Date.

5. **Token auto-refresh**: The JEFIT access token (7-day expiry) is automatically refreshed using the refresh token. On Railway, refreshed tokens are persisted via Railway's GraphQL API (`variableCollectionUpsert` mutation). Locally, they're written back to `.env`. The refresh token (3-month expiry) still requires manual browser login renewal — update in Railway dashboard or local `.env`.

6. **Railway cron over local scheduling**: The sync runs as a Railway cron job rather than being triggered by OpenClaw. This decouples data sync from AI analysis and eliminates dependency on a local machine being online.

7. **Date normalization**: Google Sheets uses DD/MM/YYYY (Australian locale). All dates are converted to ISO 8601 (YYYY-MM-DD) before writing to Notion.

8. **OpenClaw as analysis engine**: No separate analysis service. OpenClaw reads Notion databases directly and applies the decision frameworks via its system prompt. The Alerts database is an audit log, not a critical path.

## Common Tasks for AI Assistants

### "Add a new exercise body part mapping"
Edit `jefit.js` → `parseSession()` → the `mapping` object inside the body parts normalization.

### "Change the strength regression thresholds"
Edit `openclaw-config.md` → update the percentage thresholds in both the Weekly Digest and Daily Check prompts.

### "Add a new field to a Notion database"
Use the Notion MCP: `notion-update-data-source` with the database's collection ID and an `ADD COLUMN` statement.

### "Debug why a workout didn't sync"
Check the JEFIT calendar endpoint for that date: `/api/v2/users/10835027/sessions/calendar`. Then check if the session endpoint returns data: `/api/v2/users/10835027/sessions?startDate={unix_ts}`. Check token status — if expired, the script should auto-refresh.

### "Backfill historical data"
`node sync.js --days N` where N is the number of days back. Already-synced data is skipped (idempotent).

### "Check current token health"
Run any sync command — token status prints at startup. Or decode the JWT in `.env` manually: the `exp` field is a Unix timestamp.

### "Test Railway deployment locally"
`railway run node sync.js --days 1` — runs the sync on your local machine using Railway's env vars. Useful for verifying credentials are set correctly without pushing/deploying.

### "Force a token refresh test"
Set a garbage `JEFIT_ACCESS_TOKEN` in Railway Variables to trigger a 401 → refresh → Railway API update cycle. Check logs to confirm `Updated Railway env vars with fresh tokens` appears.

## Railway Environment Variables

These are configured in the Railway dashboard (Settings → Variables):

| Variable | Source | Notes |
|---|---|---|
| `JEFIT_ACCESS_TOKEN` | Browser cookies | Auto-refreshed by script every ~7 days |
| `JEFIT_REFRESH_TOKEN` | Browser cookies | Manual renewal every ~3 months |
| `JEFIT_USER_ID` | Static | `10835027` |
| `NOTION_API_KEY` | Notion integrations page | Starts with `ntn_` |
| `NOTION_WORKOUTS_DB` | Static | Database IDs from Notion |
| `NOTION_EXERCISE_LOGS_DB` | Static | |
| `NOTION_BODY_METRICS_DB` | Static | |
| `NOTION_ALERTS_DB` | Static | |
| `GOOGLE_SHEETS_API_KEY` | Google Cloud Console | |
| `GOOGLE_SHEET_ID` | Static | |
| `RAILWAY_API_TOKEN` | Railway Account Settings → Tokens | Used by script to persist refreshed JEFIT tokens |
| `RAILWAY_SERVICE_ID` | Auto-provided by Railway | |
| `RAILWAY_ENVIRONMENT_ID` | Auto-provided by Railway | |