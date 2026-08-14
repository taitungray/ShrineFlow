import { Router } from 'express';
import {
  createClient,
  ensureDefaultClientFromEnv,
  getClientRaw,
  listClients,
  updateClient,
  upsertAccount,
  findAccount,
} from '../clients.js';
import { createFacebookPublisher } from '../facebook.js';
import { createInstagramPublisher } from '../instagram.js';
import { createThreadsPublisher } from '../threads.js';

export function createClientsRouter({ onAccountsChanged } = {}) {
  const router = Router();

  router.get('/clients', async (_request, response) => {
    await ensureDefaultClientFromEnv();
    response.json(await listClients());
  });

  router.post('/clients', async (request, response) => {
    try {
      const client = await createClient({
        name: request.body?.name,
        notes: request.body?.notes,
      });
      response.status(201).json(client);
    } catch (error) {
      response.status(400).json({ error: error.message || '無法建立品牌。' });
    }
  });

  router.patch('/clients/:clientId', async (request, response) => {
    try {
      const client = await updateClient(request.params.clientId, {
        name: request.body?.name,
        notes: request.body?.notes,
      });
      if (!client) return response.status(404).json({ error: '找不到品牌。' });
      response.json(client);
    } catch (error) {
      response.status(400).json({ error: error.message || '無法更新品牌。' });
    }
  });

  router.put('/clients/:clientId/accounts', async (request, response) => {
    try {
      const client = await upsertAccount(request.params.clientId, request.body || {});
      if (!client) return response.status(404).json({ error: '找不到品牌。' });
      if (typeof onAccountsChanged === 'function') {
        await onAccountsChanged(client);
      }
      response.json(client);
    } catch (error) {
      response.status(400).json({ error: error.message || '無法儲存平台設定。' });
    }
  });

  router.post('/clients/:clientId/accounts/:accountId/test', async (request, response) => {
    const client = await getClientRaw(request.params.clientId);
    if (!client) return response.status(404).json({ error: '找不到品牌。' });
    const account = findAccount(client, request.params.accountId);
    if (!account) return response.status(404).json({ error: '找不到平台設定。' });
    let publisher;
    let platformName;
    if (account.platformId === 'facebook') {
      platformName = 'Facebook';
      publisher = createFacebookPublisher({
        pageId: account.credentials?.pageId,
        pageAccessToken: account.credentials?.pageAccessToken,
        graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
        graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
      });
    } else if (account.platformId === 'instagram') {
      platformName = 'Instagram';
      publisher = createInstagramPublisher({
        userId: account.credentials?.userId,
        accessToken: account.credentials?.accessToken,
        graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
        graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
      });
    } else if (account.platformId === 'threads') {
      platformName = 'Threads';
      publisher = createThreadsPublisher({
        userId: account.credentials?.userId,
        accessToken: account.credentials?.accessToken,
      });
    } else {
      return response.status(400).json({ error: '此平台尚不支援連線測試。' });
    }
    if (!publisher.configured) {
      return response.status(400).json({
        configured: false,
        connected: false,
        error: `${platformName} 平台憑證尚未設定完整。`,
      });
    }
    try {
      const profile = await publisher.verify();
      response.json({
        configured: true,
        connected: true,
        ...(account.platformId === 'facebook' ? { page: profile } : { profile }),
      });
    } catch (error) {
      response.status(502).json({
        configured: true,
        connected: false,
        error: error.message || `無法驗證 ${platformName} 平台連線。`,
      });
    }
  });

  return router;
}
