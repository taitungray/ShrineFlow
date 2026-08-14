import { Router } from 'express';
import {
  createClient,
  ensureDefaultClientFromEnv,
  getClientRaw,
  listClients,
  updateClient,
  updateAccountHealth,
  upsertAccount,
  findAccount,
} from '../clients.js';
import { createFacebookPublisher } from '../facebook.js';
import { createInstagramPublisher } from '../instagram.js';
import { createThreadsPublisher } from '../threads.js';
import { getRepositories } from '../repositories.js';
import { upsertMembership } from '../access-data.js';
import { canAccessClient } from '../request-scope.js';

export function createClientsRouter({ onAccountsChanged, repositories = getRepositories() } = {}) {
  const router = Router();

  async function persistHealth(clientId, accountId, health) {
    try {
      return await updateAccountHealth(clientId, accountId, health);
    } catch {
      return null;
    }
  }

  router.get('/clients', async (request, response) => {
    await ensureDefaultClientFromEnv();
    response.json((await listClients()).filter((client) => canAccessClient(request, client.id)));
  });

  router.post('/clients', async (request, response) => {
    try {
      const client = await createClient({
        name: request.body?.name,
        notes: request.body?.notes,
      });
      if (request.actor?.uid && !request.actor.legacy) {
        await upsertMembership({
          clientId: client.id,
          userId: request.actor.uid,
          role: 'owner',
          status: 'active',
          invitedBy: request.actor.uid,
        }, repositories);
      }
      response.status(201).json(client);
    } catch (error) {
      response.status(error.status || 400).json({ error: error.message || '無法建立品牌。', code: error.code });
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
      response.status(error.status || 400).json({ error: error.message || '無法儲存平台設定。', code: error.code });
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
      const checkedAt = new Date().toISOString();
      const updated = await persistHealth(request.params.clientId, request.params.accountId, {
        status: 'connected',
        checkedAt,
      });
      response.json({
        configured: true,
        connected: true,
        ...(account.platformId === 'facebook' ? { page: profile } : { profile }),
        tokenHealth: updated?.accounts?.find((item) => item.id === account.id)?.tokenHealth || null,
      });
    } catch (error) {
      const checkedAt = new Date().toISOString();
      const message = error.message || `無法驗證 ${platformName} 平台連線。`;
      const updated = await persistHealth(request.params.clientId, request.params.accountId, {
        status: 'error',
        checkedAt,
        error: message,
      });
      response.status(502).json({
        configured: true,
        connected: false,
        error: message,
        tokenHealth: updated?.accounts?.find((item) => item.id === account.id)?.tokenHealth || null,
      });
    }
  });

  return router;
}
