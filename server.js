import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initStorage, directories } from './lib/store.js';
import { createFacebookPublisher } from './lib/facebook.js';
import { createInstagramPublisher } from './lib/instagram.js';
import { createThreadsPublisher } from './lib/threads.js';
import { buildPublishingState } from './lib/platforms.js';
import { createAiService } from './lib/ai-service.js';
import { createScheduler, migrateScheduleIntoTargets } from './lib/scheduler.js';
import { ensureDefaultClientFromEnv, getClientRaw, findAccount, listClientsRaw } from './lib/clients.js';

import { createConfigRouter } from './lib/routes/config.js';
import { createGodsRouter } from './lib/routes/gods.js';
import { createPostsRouter } from './lib/routes/posts.js';
import { createGenerateRouter } from './lib/routes/generate.js';
import { createScheduleRouter } from './lib/routes/schedule.js';
import { createPublishRouter } from './lib/routes/publish.js';
import { createInsightsRouter } from './lib/routes/insights.js';
import { createInboxRouter } from './lib/routes/inbox.js';
import { createSettingsRouter } from './lib/routes/settings.js';
import { createClientsRouter } from './lib/routes/clients.js';
import { createTemplatesRouter } from './lib/routes/templates.js';
import { createCampaignsRouter } from './lib/routes/campaigns.js';
import {
  createFacebookInsightsClient,
  createInstagramInsightsClient,
  createThreadsInsightsClient,
} from './lib/insights.js';
import {
  createFacebookInboxClient,
  createInstagramInboxClient,
  createThreadsInboxClient,
} from './lib/inbox.js';

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

async function resolveAccount({ clientId, accountId, account }) {
  if (account) return account;
  return findAccount(await getClientRaw(clientId), accountId);
}

async function resolveFacebookPublisher(context) {
  const account = await resolveAccount(context);
  if (account?.credentials?.pageId && account?.credentials?.pageAccessToken) {
    return createFacebookPublisher({
      pageId: account.credentials.pageId,
      pageAccessToken: account.credentials.pageAccessToken,
      graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
      graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
    });
  }
  return facebookPublisher;
}

async function resolveInstagramPublisher(context) {
  const account = await resolveAccount(context);
  return createInstagramPublisher({
    userId: account?.credentials?.userId,
    accessToken: account?.credentials?.accessToken,
    graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
    publicMediaBaseUrl: process.env.PUBLIC_MEDIA_BASE_URL,
  });
}

async function resolveThreadsPublisher(context) {
  const account = await resolveAccount(context);
  return createThreadsPublisher({
    userId: account?.credentials?.userId,
    accessToken: account?.credentials?.accessToken,
    graphVersion: process.env.THREADS_GRAPH_VERSION || 'v1.0',
    graphBaseUrl: process.env.THREADS_GRAPH_BASE_URL || 'https://graph.threads.net',
    publicMediaBaseUrl: process.env.PUBLIC_MEDIA_BASE_URL,
  });
}

async function resolveFacebookInsights(context) {
  const account = await resolveAccount(context);
  return createFacebookInsightsClient({
    pageId: account?.credentials?.pageId || process.env.FACEBOOK_PAGE_ID,
    pageAccessToken: account?.credentials?.pageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
  });
}

async function resolveInstagramInsights(context) {
  const account = await resolveAccount(context);
  return createInstagramInsightsClient({
    userId: account?.credentials?.userId,
    accessToken: account?.credentials?.accessToken,
    graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
  });
}

async function resolveThreadsInsights(context) {
  const account = await resolveAccount(context);
  return createThreadsInsightsClient({
    userId: account?.credentials?.userId,
    accessToken: account?.credentials?.accessToken,
    graphVersion: process.env.THREADS_GRAPH_VERSION || 'v1.0',
    graphBaseUrl: process.env.THREADS_GRAPH_BASE_URL || 'https://graph.threads.net',
  });
}

async function resolveFacebookInbox(context) {
  const account = await resolveAccount(context);
  return createFacebookInboxClient({
    pageId: account?.credentials?.pageId || process.env.FACEBOOK_PAGE_ID,
    pageAccessToken: account?.credentials?.pageAccessToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
  });
}

async function resolveInstagramInbox(context) {
  const account = await resolveAccount(context);
  return createInstagramInboxClient({
    userId: account?.credentials?.userId,
    accessToken: account?.credentials?.accessToken,
    graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
  });
}

async function resolveThreadsInbox(context) {
  const account = await resolveAccount(context);
  return createThreadsInboxClient({
    userId: account?.credentials?.userId,
    accessToken: account?.credentials?.accessToken,
    graphVersion: process.env.THREADS_GRAPH_VERSION || 'v1.0',
    graphBaseUrl: process.env.THREADS_GRAPH_BASE_URL || 'https://graph.threads.net',
  });
}

async function refreshPublishingState() {
  const state = buildPublishingState({
    facebookConfigured: facebookPublisher.configured,
    facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
    clients: await listClientsRaw(),
  });
  publishingPlatforms = state.platforms;
  publishingAccounts = state.accounts;
}

async function initServices() {
  facebookPublisher = createFacebookPublisher({
    pageId: process.env.FACEBOOK_PAGE_ID,
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
    graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
    graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
  });

  await refreshPublishingState();

  scheduler = createScheduler({
    facebookPublisher,
    createInstagramPublisher,
    createThreadsPublisher,
    resolvePublicMediaBaseUrl: () => process.env.PUBLIC_MEDIA_BASE_URL || '',
  });
}

await initServices();
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
    await initServices();
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

app.use('/api', createClientsRouter({
  onAccountsChanged: refreshPublishingState,
}));
app.use('/api', createTemplatesRouter());
app.use('/api', createCampaignsRouter());
app.use('/api', (request, response, next) => createInsightsRouter({
  resolveFacebookInsights,
  resolveInstagramInsights,
  resolveThreadsInsights,
})(request, response, next));
app.use('/api', (request, response, next) => createInboxRouter({
  resolveFacebookInbox,
  resolveInstagramInbox,
  resolveThreadsInbox,
})(request, response, next));
app.use('/api', createGodsRouter());
app.use('/api', createPostsRouter());
app.use('/api', (request, response, next) => createGenerateRouter({ aiService })(request, response, next));
app.use('/api', (request, response, next) => createScheduleRouter({
  publishingPlatforms,
  resolveFacebookPublisher,
})(request, response, next));
app.use('/api', (request, response, next) => createPublishRouter({
  facebookPublisher,
  resolveFacebookPublisher,
  resolveInstagramPublisher,
  resolveThreadsPublisher,
})(request, response, next));

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
