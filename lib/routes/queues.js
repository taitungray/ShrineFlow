import { Router } from 'express';
import { findAccount, listClientsRaw, updateAccountQueue } from '../clients.js';
import { getRepositories } from '../repositories.js';
import { normalizeQueue } from '../queue.js';

function requestedClientId(request) {
  return String(
    request.body?.clientId
      || request.query?.clientId
      || request.authorizedClientId
      || '',
  ).trim();
}

function responsePayload(clientId, account, queue) {
  return {
    clientId,
    accountId: account.id,
    accountName: account.name || account.id,
    platformId: account.platformId,
    queue,
  };
}

export function createQueuesRouter({ repositories = getRepositories() } = {}) {
  const router = Router();

  router.get('/queues', async (request, response) => {
    const clientId = requestedClientId(request);
    const accountId = String(request.query.accountId || '').trim();
    const clients = await listClientsRaw(repositories);
    const client = clients.find((item) => item.id === clientId) || null;
    const account = findAccount(client, accountId);
    if (!client) return response.status(404).json({ error: '找不到品牌。' });
    if (!account) return response.status(404).json({ error: '找不到平台連線。' });
    try {
      const queue = normalizeQueue(account.queue, { accountId: account.id, platformId: account.platformId });
      return response.json(responsePayload(client.id, account, queue));
    } catch (error) {
      return response.status(409).json({ error: error.message || '佇列設定無效。', code: 'QUEUE_CONFIG_INVALID' });
    }
  });

  router.put('/queues', async (request, response) => {
    const clientId = requestedClientId(request);
    const accountId = String(request.body?.accountId || '').trim();
    const clients = await listClientsRaw(repositories);
    const client = clients.find((item) => item.id === clientId) || null;
    const account = findAccount(client, accountId);
    if (!client) return response.status(404).json({ error: '找不到品牌。' });
    if (!account) return response.status(404).json({ error: '找不到平台連線。' });

    try {
      const source = request.body?.queue && typeof request.body.queue === 'object'
        ? request.body.queue
        : request.body || {};
      const queue = normalizeQueue(source, { accountId: account.id, platformId: account.platformId });
      queue.updatedAt = new Date().toISOString();
      const updated = await updateAccountQueue(client.id, account.id, queue, repositories);
      if (!updated) return response.status(404).json({ error: '找不到平台連線。' });
      const updatedAccount = findAccount(updated, account.id) || account;
      return response.json(responsePayload(client.id, updatedAccount, queue));
    } catch (error) {
      return response.status(error.status || 400).json({ error: error.message || '無法儲存佇列設定。', code: 'QUEUE_CONFIG_INVALID' });
    }
  });

  return router;
}
