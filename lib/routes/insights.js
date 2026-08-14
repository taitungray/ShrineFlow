import { Router } from 'express';
import { getClientRaw, findAccount, listClientsRaw } from '../clients.js';

function resolverFor(platformId, resolvers) {
  return {
    facebook: resolvers.resolveFacebookInsights,
    instagram: resolvers.resolveInstagramInsights,
    threads: resolvers.resolveThreadsInsights,
  }[platformId];
}

function safeError(error) {
  return {
    message: error?.message || 'Insights 同步失敗。',
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

export function createInsightsRouter({
  resolveFacebookInsights,
  resolveInstagramInsights,
  resolveThreadsInsights,
  getClient = getClientRaw,
  listClients = listClientsRaw,
} = {}) {
  const router = Router();

  router.get('/insights', async (request, response) => {
    const requestedClientId = String(request.query.clientId || '').trim();
    const client = requestedClientId
      ? await getClient(requestedClientId)
      : (await listClients())[0];
    if (requestedClientId && !client) {
      return response.status(404).json({ error: '找不到品牌。' });
    }
    if (!client) {
      return response.json({ status: 'unavailable', clientId: '', fetchedAt: null, sources: [] });
    }

    const platformId = String(request.query.platform || '').trim();
    const accountId = String(request.query.accountId || '').trim();
    const metrics = String(request.query.metrics || '').trim();
    const accounts = (client.accounts || []).filter((account) => (
      (!platformId || account.platformId === platformId)
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
        return { ...base, status: 'not_configured', data: [] };
      }

      const resolver = resolverFor(account.platformId, {
        resolveFacebookInsights,
        resolveInstagramInsights,
        resolveThreadsInsights,
      });
      if (typeof resolver !== 'function') {
        return {
          ...base,
          status: 'not_configured',
          data: [],
          error: { message: '此平台尚未接入 Insights。', category: 'unsupported' },
        };
      }

      try {
        const insightsClient = await resolver({
          clientId: client.id,
          accountId: account.id,
          account,
          client,
        });
        if (!insightsClient?.configured) {
          return { ...base, status: 'not_configured', data: [] };
        }
        const payload = await insightsClient.fetchAccountInsights({
          since: request.query.since,
          until: request.query.until,
          metrics,
        });
        return { ...base, ...payload, status: 'synced' };
      } catch (error) {
        return { ...base, status: 'error', data: [], error: safeError(error) };
      }
    }));

    return response.json({
      status: overallStatus(sources),
      clientId: client.id,
      fetchedAt: new Date().toISOString(),
      sources,
    });
  });

  return router;
}
