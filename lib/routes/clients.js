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

export function createClientsRouter() {
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
      response.status(400).json({ error: error.message || '無法建立客戶。' });
    }
  });

  router.patch('/clients/:clientId', async (request, response) => {
    try {
      const client = await updateClient(request.params.clientId, {
        name: request.body?.name,
        notes: request.body?.notes,
      });
      if (!client) return response.status(404).json({ error: '找不到客戶。' });
      response.json(client);
    } catch (error) {
      response.status(400).json({ error: error.message || '無法更新客戶。' });
    }
  });

  router.put('/clients/:clientId/accounts', async (request, response) => {
    try {
      const client = await upsertAccount(request.params.clientId, request.body || {});
      if (!client) return response.status(404).json({ error: '找不到客戶。' });
      response.json(client);
    } catch (error) {
      response.status(400).json({ error: error.message || '無法儲存帳號。' });
    }
  });

  router.post('/clients/:clientId/accounts/:accountId/test', async (request, response) => {
    const client = await getClientRaw(request.params.clientId);
    if (!client) return response.status(404).json({ error: '找不到客戶。' });
    const account = findAccount(client, request.params.accountId);
    if (!account) return response.status(404).json({ error: '找不到帳號。' });
    if (account.platformId !== 'facebook') {
      return response.status(400).json({ error: '此平台尚不支援連線測試。' });
    }

    const publisher = createFacebookPublisher({
      pageId: account.credentials?.pageId,
      pageAccessToken: account.credentials?.pageAccessToken,
      graphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
      graphBaseUrl: process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
    });
    if (!publisher.configured) {
      return response.status(400).json({ configured: false, connected: false, error: 'Facebook 帳號尚未設定完整。' });
    }
    try {
      const page = await publisher.verify();
      response.json({ configured: true, connected: true, page });
    } catch (error) {
      response.status(502).json({
        configured: true,
        connected: false,
        error: error.message || '無法驗證 Facebook 粉專連線。',
      });
    }
  });

  return router;
}
