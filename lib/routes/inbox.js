import { Router } from 'express';
import { getClientRaw, listClientsRaw } from '../clients.js';

function resolverFor(platformId, resolvers) {
  return {
    facebook: resolvers.resolveFacebookInbox,
    instagram: resolvers.resolveInstagramInbox,
    threads: resolvers.resolveThreadsInbox,
  }[platformId];
}

function safeError(error) {
  return {
    message: error?.message || 'Inbox 同步失敗。',
    category: error?.category || 'unknown',
    status: error?.status,
    code: error?.code,
    retriable: Boolean(error?.retriable),
  };
}

function overallStatus(sources) {
  if (sources.some((source) => source.status === 'synced')) {
    return sources.some((source) => source.status === 'error') ? 'partial' : 'synced';
  }
  if (sources.some((source) => source.status === 'error')) return 'error';
  return 'unavailable';
}

export function createInboxRouter({
  resolveFacebookInbox,
  resolveInstagramInbox,
  resolveThreadsInbox,
  getClient = getClientRaw,
  listClients = listClientsRaw,
} = {}) {
  const router = Router();

  router.get('/inbox', async (request, response) => {
    const requestedClientId = String(request.query.clientId || '').trim();
    const client = requestedClientId
      ? await getClient(requestedClientId)
      : (await listClients())[0];
    if (requestedClientId && !client) {
      return response.status(404).json({ error: '找不到品牌。' });
    }
    if (!client) return response.json({ status: 'unavailable', clientId: '', fetchedAt: null, sources: [] });

    const requestedPlatform = String(request.query.platform || '').trim();
    const accountId = String(request.query.accountId || '').trim();
    const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 25));
    const accounts = (client.accounts || []).filter((account) => (
      (!requestedPlatform || account.platformId === requestedPlatform)
      && (!accountId || account.id === accountId)
      && ['facebook', 'instagram', 'threads'].includes(account.platformId)
    ));

    const sources = await Promise.all(accounts.map(async (account) => {
      const base = {
        clientId: client.id,
        accountId: account.id,
        accountName: account.name || account.id,
        platformId: account.platformId,
      };
      if (account.enabled === false || account.configured === false) {
        return { ...base, status: 'not_configured', items: [] };
      }

      const resolver = resolverFor(account.platformId, {
        resolveFacebookInbox,
        resolveInstagramInbox,
        resolveThreadsInbox,
      });
      if (typeof resolver !== 'function') {
        return {
          ...base,
          status: 'not_configured',
          items: [],
          error: { message: '此平台尚未接入 Inbox。', category: 'unsupported' },
        };
      }

      try {
        const inboxClient = await resolver({
          clientId: client.id,
          accountId: account.id,
          account,
          client,
        });
        if (!inboxClient?.configured) return { ...base, status: 'not_configured', items: [] };
        const payload = await inboxClient.fetchRecent({ limit });
        return { ...base, ...payload, status: 'synced' };
      } catch (error) {
        return { ...base, status: 'error', items: [], error: safeError(error) };
      }
    }));

    return response.json({
      status: overallStatus(sources),
      clientId: client.id,
      fetchedAt: new Date().toISOString(),
      retention: 'provider_backed',
      sources,
    });
  });

  return router;
}
