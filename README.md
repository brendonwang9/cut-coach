# 🏋️ Cut Coach Sync

Sync pipeline that pulls workout data from JEFIT and weight data from Google Sheets into Notion databases for AI-powered cut monitoring.

## Architecture

```
JEFIT (workouts) ──┐
                   ├──→ Notion Databases ──→ OpenClaw (AI) ──→ Telegram
Google Sheets (weight) ┘      ↑
                              │
                        Claude Cowork (reads/writes)
```

## Quick Start

### 1. Install
```bash
npm install
cp .env.example .env
```

### 2. Get Your Credentials

**Notion API Key:**
1. Go to https://www.notion.so/my-integrations
2. Create a new integration (name it "Cut Coach")
3. Copy the Internal Integration Token
4. Go to your Cut Coach page in Notion → Share → Invite the integration
5. Make sure to share ALL 4 databases (Workouts, Exercise Logs, Body Metrics, Alerts)

**JEFIT Session Cookie:**
1. Log into jefit.com in your browser
2. Open DevTools (F12) → Network tab
3. Refresh the page
4. Click any request to jefit.com → Headers → Cookie
5. Copy the full cookie string

**Google Sheets API Key:**
1. Go to https://console.cloud.google.com
2. Create a project (or use existing)
3. Enable the Google Sheets API
4. Go to Credentials → Create API Key
5. Restrict the key to Google Sheets API only

### 3. Fill in .env
```bash
JEFIT_SESSION_COOKIE=your_cookie
NOTION_API_KEY=ntn_your_key
GOOGLE_SHEETS_API_KEY=your_key
```

### 4. Run Initial Backfill
```bash
npm run sync:backfill    # Syncs last 90 days
```

### 5. Ongoing Sync
```bash
npm run sync             # Syncs last 7 days (daily use)
npm run sync:week        # Same as above
npm run sync:month       # Syncs last 30 days
npm run sync:workouts    # Only JEFIT data
npm run sync:weight      # Only weight data
```

## Notion Database IDs

These are pre-configured from your workspace:

| Database | ID |
|---|---|
| Workouts | `1224293308dd46ef904212d29e141e04` |
| Exercise Logs | `0ba489f819af4109abf1f9281ba60680` |
| Body Metrics | `18c8a9a691324540ae20a0dc6d3532f0` |
| Alerts | `ea9b74179f6a4075a23084e08c9770bc` |

## JEFIT API Reference

Undocumented internal API discovered via network analysis:

| Endpoint | Method | Description |
|---|---|---|
| `/api/v2/users/{id}/sessions/calendar` | GET | All workout dates since Feb 2023 |
| `/api/v2/users/{id}/sessions?startDate={unix}` | GET | Full session data with sets/reps/1RM |
| `/api/v2/exercises/{id}` | GET | Exercise name, body parts, equipment |
| `/api/v2/users/{id}/exercises` | GET | Custom exercises |

**Note:** The JEFIT session cookie expires periodically. If sync fails with 401/403, get a fresh cookie from your browser.

## Automation

### Cron Job (run daily at 10am)
```bash
# Add to crontab -e
0 10 * * * cd /path/to/cut-coach-sync && node sync.js >> sync.log 2>&1
```

### OpenClaw Integration
OpenClaw reads the Notion databases directly on schedule. The decision frameworks 
for alerts are configured in OpenClaw's system prompt — see the Cut Coach 
Architecture doc for the complete framework definitions.

## File Structure

```
cut-coach-sync/
├── config.js          # Configuration (reads from .env)
├── jefit.js           # JEFIT API client
├── sheets.js          # Google Sheets reader
├── notion-sync.js     # Notion database writer
├── sync.js            # Main orchestrator (run this)
├── .env.example       # Template for credentials
├── .env               # Your actual credentials (gitignored)
├── package.json       # Dependencies and scripts
└── README.md          # This file
```
