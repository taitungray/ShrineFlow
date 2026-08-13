import { Router } from 'express';
import fs from 'node:fs';
import { listClients, getClientRaw } from '../clients.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

function accountsForClient(client) {
  if (!client) return [];
  return (client.accounts || []).map((account) => ({
    id: account.id,
    platformId: account.platformId,
    name: account.name,
    configured: Boolean(account.configured),
    enabled: account.enabled !== false,
  }));
}

export function createConfigRouter({ aiService, facebookPublisher, publishingPlatforms, publishingAccounts, schedulerIntervalMs }) {
  const router = Router();

  router.get('/config', async (_request, response) => {
    const clients = await listClients();
    response.json({
      version: pkg.version || '0.2.1',
      aiConfigured: aiService.configured,
      provider: aiService.provider,
      model: aiService.models.join(', '),
      facebookConfigured: facebookPublisher.configured,
      facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
      facebookSchedulerIntervalSeconds: schedulerIntervalMs / 1000,
      publicMediaBaseUrlConfigured: Boolean(String(process.env.PUBLIC_MEDIA_BASE_URL || '').trim()),
      publishingPlatforms,
      publishingAccounts,
      clients,
    });
  });

  router.get('/accounts', async (request, response) => {
    const clientId = String(request.query.clientId || '').trim();
    if (clientId) {
      const client = await getClientRaw(clientId);
      if (!client) return response.status(404).json({ error: '找不到客戶。' });
      return response.json(accountsForClient(client));
    }
    response.json(publishingAccounts);
  });

  router.get('/facebook/status', async (_request, response) => {
    if (!facebookPublisher.configured) return response.json({ configured: false, connected: false });
    try {
      const page = await facebookPublisher.verify();
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
