// ============================================================
// CUT COACH SYNC - Configuration
// ============================================================
// Copy .env.example to .env and fill in your values

require('dotenv').config();

module.exports = {
  // JEFIT
  jefit: {
    userId: process.env.JEFIT_USER_ID || '10835027',
    baseUrl: 'https://www.jefit.com/api/v2',
    // JWT tokens from browser cookies (DevTools → Application → Cookies → jefit.com)
    accessToken: process.env.JEFIT_ACCESS_TOKEN || '',
    refreshToken: process.env.JEFIT_REFRESH_TOKEN || '',
  },

  // Notion
  notion: {
    apiKey: process.env.NOTION_API_KEY || '',
    databases: {
      workouts: process.env.NOTION_WORKOUTS_DB || '1224293308dd46ef904212d29e141e04',
      exerciseLogs: process.env.NOTION_EXERCISE_LOGS_DB || '0ba489f819af4109abf1f9281ba60680',
      bodyMetrics: process.env.NOTION_BODY_METRICS_DB || '18c8a9a691324540ae20a0dc6d3532f0',
      alerts: process.env.NOTION_ALERTS_DB || 'ea9b74179f6a4075a23084e08c9770bc',
    },
  },

  // Google Sheets
  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEET_ID || '1wqtSD9IpYRV-qsrj_5HNmqBHJrduFGeF6gtYmyTFPuI',
    apiKey: process.env.GOOGLE_SHEETS_API_KEY || '',
  },

  // Railway (for persisting refreshed JEFIT tokens as env vars)
  railway: {
    apiToken: process.env.RAILWAY_API_TOKEN || '',
    serviceId: process.env.RAILWAY_SERVICE_ID || '',
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID || '',
  },

  // Sync settings
  sync: {
    // How many days back to backfill on first run
    backfillDays: 90,
    // Timezone offset for JEFIT calendar
    timezoneOffset: '+11:00',
  },
};
