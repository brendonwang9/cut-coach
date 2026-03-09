# 🏋️ Cut Coach Sync

Proactive AI-powered cut monitoring system. Syncs JEFIT workouts and Google Sheets weight data into Notion, where OpenClaw analyses trends and sends alerts via Telegram.

## Architecture

```
JEFIT (workouts) ──┐
                   ├──→ Notion Databases ──→ OpenClaw (AI) ──→ Telegram
Google Sheets (weight) ┘      ↑
                              │
                        Claude Cowork (reads/writes)
```

## Commands

### Setup (run once)
```bash
npm install              # Install dependencies (dotenv, @notionhq/client)
cp .env.example .env     # Create your local config file, then fill in credentials
```

### Sync Commands
```bash
npm run sync             # Sync last 7 days — use this daily
npm run sync:week        # Same as above
npm run sync:month       # Sync last 30 days
npm run sync:backfill    # Sync last 90 days — use for initial setup
npm run sync:workouts    # Only sync JEFIT workout data, skip weight
npm run sync:weight      # Only sync Google Sheets weight data, skip workouts
```

### Custom Date Ranges
```bash
node sync.js --days 250  # Sync last 250 days (any number works)
node sync.js --days 14   # Sync last 2 weeks
```

### What Each Sync Does
- **Workouts sync**: Calls JEFIT API → creates entries in Notion Workouts + Exercise Logs databases
- **Weight sync**: Reads Google Sheets "Weight" tab → creates/updates entries in Notion Body Metrics database
- All syncs are **idempotent** — running them twice won't create duplicates

### Token Status
Every sync prints your JEFIT token health at startup:
```
🔑 Access token: 6 days remaining          # Auto-refreshes, no action needed
🔑 Refresh token: 89 days remaining        # Manual update needed every ~3 months
⚠️  REFRESH TOKEN: only 5 days remaining!  # Update soon — log into jefit.com
```

## Credentials Setup

### 1. JEFIT Tokens
1. Log into jefit.com in your browser
2. Open DevTools (Cmd+Option+I) → Application tab → Cookies → jefit.com
3. Copy the VALUE of `jefitAccessToken` (starts with `eyJ...`)
4. Copy the VALUE of `jefitRefreshToken` (starts with `eyJ...`)
5. The access token auto-refreshes weekly. The refresh token must be manually updated every ~3 months.

### 2. Notion Integration
1. Go to https://www.notion.so/profile/integrations
2. Create internal integration named "Cut Coach" → copy the secret token
3. Go to your Cut Coach page in Notion → Share → Invite "Cut Coach" integration
4. This gives the script permission to read/write your 4 databases

### 3. Google Sheets API Key
1. Go to https://console.cloud.google.com → Credentials
2. Use existing API key or create new one. Oauth or private pages

## Automation

### Cron Job (run daily at 10am AEST)
```bash
# Add to crontab -e
0 10 * * * cd /path/to/cut-coach-sync && node sync.js >> sync.log 2>&1
```

### OpenClaw Integration
OpenClaw reads the Notion databases directly on its own schedule. The decision frameworks for alerts (strength regression, weight trajectory, fatigue composite, diet break triggers) are configured in OpenClaw's system prompt. See the Cut Coach Architecture doc for complete framework definitions.

## Notion Database IDs

Pre-configured from your workspace:

| Database | Purpose | ID |
|---|---|---|
| 💪 Workouts | One row per gym session 
| 📊 Exercise Logs | One row per exercise per session (strength tracking) 
| ⚖️ Body Metrics | Daily weight, weekly averages, BF% estimates
| 🚨 Alerts & Analysis | Alert history log (green/yellow/red) 

## JEFIT API Reference

Undocumented internal API discovered via browser network analysis:

| Endpoint | Method | Description |
|---|---|---|
| `/api/v2/users/{id}/sessions/calendar` | GET | All workout dates since Feb 2023 |
| `/api/v2/users/{id}/sessions?startDate={unix}` | GET | Full session data with sets/reps/1RM |
| `/api/v2/exercises/{id}` | GET | Exercise name, body parts, equipment |
| `/api/v2/users/{id}/exercises` | GET | Custom user exercises |

Authentication uses JWT tokens sent as cookies. The access token expires weekly (auto-refreshed by the script). The refresh token expires every ~3 months (requires manual browser login to renew).

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Cannot find module 'dotenv'` | Dependencies not installed | Run `npm install` |
| `JEFIT calendar fetch failed: 401` | Access token expired | Script auto-refreshes — if it still fails, refresh token is dead. Log into jefit.com and copy fresh tokens to .env |
| `Google Sheets fetch failed: 400` | Wrong sheet tab name or range | Check that the "Weight" tab exists in your spreadsheet |
| `Could not find page with ID` | Notion integration not shared | Go to Cut Coach page → Share → invite "Cut Coach" integration |
| `rate_limited` / `429` | Too many API calls | Wait 1 minute and retry with fewer days |

## File Structure

```
cut-coach-sync/
├── config.js          # Configuration (reads from .env)
├── jefit.js           # JEFIT API client with auto-refresh
├── sheets.js          # Google Sheets reader
├── notion-sync.js     # Notion database writer + query helpers
├── sync.js            # Main orchestrator (run this)
├── .env.example       # Template for credentials
├── .env               # Your actual credentials (gitignored, local only)
├── package.json       # Dependencies and npm scripts
└── README.md          # This file
```
