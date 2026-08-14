import crypto from 'node:crypto';
import { Router } from 'express';
import { listClientsRaw } from '../clients.js';
import { markInboxSyncHint } from '../inbox-metadata.js';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMetaWebhookSignature(rawBody, signature, appSecret) {
  if (!appSecret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

function platformFromWebhookObject(object) {
  const value = String(object || '').trim().toLowerCase();
  if (value === 'instagram') return 'instagram';
  if (value === 'threads') return 'threads';
  if (value === 'page') return 'facebook';
  return '';
}

export function extractMetaWebhookSignals(payload = {}) {
  const platformId = platformFromWebhookObject(payload.object);
  return (Array.isArray(payload.entry) ? payload.entry : [])
    .map((entry) => {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
      const eventType = changes[0]?.field
        || (messaging.length ? 'messaging' : '')
        || 'unknown';
      return {
        ownerId: String(entry?.id || '').trim(),
        platformId,
        eventType: String(eventType).slice(0, 80),
        eventCount: Math.max(1, changes.length + messaging.length),
      };
    })
    .filter((signal) => signal.ownerId);
}

function accountOwnerIds(account) {
  const credentials = account?.credentials || {};
  return [
    credentials.pageId,
    credentials.userId,
    account?.externalId,
    String(account?.id || '').split(':').slice(1).join(':'),
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

export async function syncMetaWebhookPayload(
  payload,
  { listClients = listClientsRaw, markSyncHint = markInboxSyncHint } = {},
) {
  const signals = extractMetaWebhookSignals(payload);
  if (!signals.length) return { receivedSignals: 0, matched: 0, unmatched: 0 };
  const clients = await listClients();
  let matched = 0;
  let unmatched = 0;

  for (const signal of signals) {
    const matches = [];
    for (const client of clients || []) {
      for (const account of client.accounts || []) {
        if ((!signal.platformId || account.platformId === signal.platformId)
          && accountOwnerIds(account).includes(signal.ownerId)) {
          matches.push({ client, account });
        }
      }
    }
    if (!matches.length) {
      unmatched += 1;
      continue;
    }
    for (const { client, account } of matches) {
      await markSyncHint({
        clientId: client.id,
        accountId: account.id,
        platformId: account.platformId,
      }, {
        eventType: signal.eventType,
        eventCount: signal.eventCount,
      });
      matched += 1;
    }
  }
  return { receivedSignals: signals.length, matched, unmatched };
}

export function createWebhookRouter({
  appSecret = process.env.META_APP_SECRET || '',
  verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || '',
  listClients = listClientsRaw,
  markSyncHint = markInboxSyncHint,
} = {}) {
  const router = Router();

  router.get('/webhooks/meta', (request, response) => {
    const mode = String(request.query['hub.mode'] || '').trim();
    const token = String(request.query['hub.verify_token'] || '').trim();
    const challenge = String(request.query['hub.challenge'] || '');
    if (!verifyToken) return response.status(503).json({ error: '尚未設定 Meta webhook verify token。' });
    if (mode !== 'subscribe' || !safeEqual(token, verifyToken)) {
      return response.status(403).json({ error: 'Meta webhook verify token 不正確。' });
    }
    return response.status(200).send(challenge);
  });

  router.post('/webhooks/meta', async (request, response) => {
    if (!appSecret) return response.status(503).json({ error: '尚未設定 Meta webhook app secret。' });
    const signature = request.get('x-hub-signature-256') || '';
    if (!verifyMetaWebhookSignature(request.rawBody, signature, appSecret)) {
      return response.status(403).json({ error: 'Meta webhook 簽章驗證失敗。' });
    }
    try {
      const sync = await syncMetaWebhookPayload(request.body, { listClients, markSyncHint });
      return response.status(200).json({ received: true, stored: false, sync });
    } catch (error) {
      return response.status(500).json({ received: true, stored: false, sync: { status: 'error' }, error: error.message });
    }
  });

  return router;
}
