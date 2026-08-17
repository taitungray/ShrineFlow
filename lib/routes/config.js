import { Router } from 'express';
import fs from 'node:fs';
import { listClients, getClientRaw } from '../clients.js';
import { getTokenHealth } from '../token-health.js';
import { canAccessClient, requestedOrAccessibleClientId } from '../request-scope.js';
import { getPlatformCapabilities } from '../capabilities.js';

import { fileURLToPath } from 'node:url';
import path from 'node:path';

function getAppVersion() {
  const candidatePaths = [
    fileURLToPath(new URL('../../package.json', import.meta.url)),
    path.resolve(process.cwd(), 'package.json'),
    path.resolve('package.json'),
  ];
  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.version) return parsed.version;
      }
    } catch {
      // Continue to next candidate
    }
  }
  return process.env.npm_package_version || 'unknown';
}

function accountsForClient(client) {
  if (!client) return [];
  return (client.accounts || []).map((account) => ({
    id: account.id,
    platformId: account.platformId,
    name: account.name,
    configured: Boolean(account.configured),
    enabled: account.enabled !== false,
    tokenExpiresAt: account.tokenExpiresAt || null,
    tokenHealth: getTokenHealth(account),
    capabilities: getPlatformCapabilities(account),
  }));
}

export function createConfigRouter({ aiService, facebookPublisher, resolveFacebookPublisher, publishingPlatforms, publishingAccounts, schedulerIntervalMs, schedulerMode = 'local', repositories }) {
  const router = Router();

  router.get('/config', async (request, response) => {
    let rawClients = await listClients();
    if (!rawClients || rawClients.length === 0) {
      const defaultClient = {
        id: 'client-1',
        name: '預設品牌',
        notes: '系統自動初始化的品牌',
        createdAt: new Date().toISOString(),
        approvalRequired: false,
        accounts: [],
      };
      if (repositories?.clients) {
        await repositories.clients.create(defaultClient).catch(() => {});
      }
      rawClients = await listClients();
      if (!rawClients || rawClients.length === 0) {
        rawClients = [defaultClient];
      }
    }
    const accessible = rawClients.filter((client) => canAccessClient(request, client.id));
    const clients = accessible.length > 0 ? accessible : rawClients;
    response.json({
      version: getAppVersion(),
      aiConfigured: aiService.configured,
      provider: aiService.provider,
      model: aiService.models.join(', '),
      facebookConfigured: facebookPublisher.configured,
      facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
      facebookSchedulerIntervalSeconds: schedulerIntervalMs / 1000,
      schedulerMode,
      storageBackend: repositories?.backend || process.env.SHRINEFLOW_STORAGE_BACKEND || 'local-json',
      mediaStorageBackend: process.env.SHRINEFLOW_MEDIA_BACKEND || 'local-filesystem',
      publicMediaBaseUrl: String(process.env.PUBLIC_MEDIA_BASE_URL || '').trim().replace(/\/$/, ''),
      publicMediaBaseUrlConfigured: Boolean(String(process.env.PUBLIC_MEDIA_BASE_URL || '').trim()),
      metaWebhookConfigured: Boolean(process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN),
      publishingPlatforms,
      publishingAccounts,
      clients,
    });
  });

  router.get('/accounts', async (request, response) => {
    const clientId = requestedOrAccessibleClientId(request, request.query.clientId);
    if (clientId) {
      const client = await getClientRaw(clientId);
      if (!client) return response.status(404).json({ error: '找不到品牌。' });
      return response.json(accountsForClient(client));
    }
    response.json(publishingAccounts);
  });

  router.get('/facebook/status', async (request, response) => {
    const clientId = requestedOrAccessibleClientId(request, request.query.clientId);
    const client = clientId ? await getClientRaw(clientId) : null;
    const account = client?.accounts?.find((item) => item.platformId === 'facebook' && item.enabled !== false);
    const scopedPublisher = clientId && typeof resolveFacebookPublisher === 'function'
      ? await resolveFacebookPublisher({ clientId, accountId: account?.id, account })
      : facebookPublisher;
    if (!scopedPublisher?.configured) return response.json({ configured: false, connected: false });
    try {
      const page = await scopedPublisher.verify();
      response.json({ configured: true, connected: true, page });
    } catch (error) {
      response.json({
        configured: true,
        connected: false,
        error: error.message || '無法驗證 Facebook 粉專連線。',
      });
    }
  });

  return router;
}
