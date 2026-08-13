import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initStorage, directories } from './lib/store.js';
import { createFacebookPublisher } from './lib/facebook.js';
import { getPublishingPlatforms } from './lib/platforms.js';
import { getPlatformAccounts } from './lib/platform-accounts.js';
import { createAiService } from './lib/ai-service.js';
import { createScheduler, migrateScheduleIntoTargets } from './lib/scheduler.js';
import { ensureDefaultClientFromEnv } from './lib/clients.js';

import { createConfigRouter } from './lib/routes/config.js';
import { createGodsRouter } from './lib/routes/gods.js';
import { createPostsRouter } from './lib/routes/posts.js';
import { createGenerateRouter } from './lib/routes/generate.js';
import { createScheduleRouter } from './lib/routes/schedule.js';
import { createPublishRouter } from './lib/routes/publish.js';
import { createSettingsRouter } from './lib/routes/settings.js';
import { createClientsRouter } from './lib/routes/clients.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);

await initStorage();
await ensureDefaultClientFromEnv();
await migrateScheduleIntoTargets();

let facebookPublisher;
let publishingPlatforms;
let publishingAccounts;
let scheduler;

function initServices() {
  facebookPublisher = createFacebookPublisher({
    pageId: process.env.FACEBOOK_PAGE_ID,
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
  });

  publishingPlatforms = getPublishingPlatforms(facebookPublisher.configured);
  publishingAccounts = getPlatformAccounts({
    facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
    facebookConfigured: facebookPublisher.configured,
  });

  scheduler = createScheduler({ facebookPublisher });
}

initServices();
const aiService = createAiService();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const staticOptions = process.env.NODE_ENV === 'production' ? undefined : {
  setHeaders: (response) => {
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
  },
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/uploads', express.static(directories.uploads, staticOptions));

app.use('/api', createSettingsRouter({
  onReloadSettings: async () => {
    initServices();
    aiService.reloadConfig();
  },
}));

app.use('/api', (request, response, next) => {
  createConfigRouter({
    aiService,
    facebookPublisher,
    publishingPlatforms,
    publishingAccounts,
    schedulerIntervalMs: scheduler.intervalMs,
  })(request, response, next);
});

app.use('/api', createClientsRouter());
app.use('/api', createGodsRouter());
app.use('/api', createPostsRouter());
app.use('/api', (request, response, next) => createGenerateRouter({ aiService })(request, response, next));
app.use('/api', (request, response, next) => createScheduleRouter({ publishingPlatforms })(request, response, next));
app.use('/api', (request, response, next) => createPublishRouter({ facebookPublisher })(request, response, next));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(400).json({ error: error.message || '請求處理失敗。' });
});

const processDueSchedules = (now) => scheduler.processDueSchedules(now);

import os from 'node:os';

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`ShrineFlow server running at:`);
  console.log(`  - Local:   http://localhost:${port}`);
  const localIps = getLocalIpAddresses();
  localIps.forEach((ip) => {
    console.log(`  - Mobile:  http://${ip}:${port}`);
  });

  if (facebookPublisher.configured) {
    console.log(`Facebook fallback credentials configured for Page ${process.env.FACEBOOK_PAGE_ID}.`);
  } else {
    console.log('Global Facebook .env credentials not set; use per-client accounts.');
  }
  processDueSchedules().catch((error) => console.error('Target scheduler failed:', error));
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${port} already in use.`);
    console.error('Close the other ShrineFlow/node window, or kill the process using that port, then retry.');
  } else {
    console.error('[ERROR] Failed to start HTTP server:', error);
  }
  process.exitCode = 1;
});

scheduler.startTimer();

export { app, server, processDueSchedules };
