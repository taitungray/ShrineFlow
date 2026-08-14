import { Router } from 'express';
import { getClientRaw, findAccount, listClientsRaw } from '../clients.js';
import { appendInsightsSnapshot, findLatestInsightsSnapshot } from '../insights-snapshots.js';

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
    return sources.some((source) => ['error', 'cached'].includes(source.status)) ? 'partial' : 'synced';
  }
  if (sources.some((source) => source.status === 'cached')) return 'cached';
  if (sources.some((source) => source.status === 'error')) return 'error';
  return 'unavailable';
}

export function createInsightsRouter({
  resolveFacebookInsights,
  resolveInstagramInsights,
  resolveThreadsInsights,
  getClient = getClientRaw,
  listClients = listClientsRaw,
  saveSnapshot = appendInsightsSnapshot,
  findSnapshot = findLatestInsightsSnapshot,
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
      const cached = await findSnapshot(base);
      const cachedResult = (errorMessage = '目前顯示最近一次已保存的 Insights。') => cached
        ? {
          ...base,
          status: 'cached',
          source: 'meta_graph_api_cached',
          fetchedAt: cached.fetchedAt,
          range: cached.range,
          data: cached.data || [],
          paging: cached.paging || null,
          error: { message: errorMessage, category: 'cached' },
        }
        : null;
      if (account.enabled === false || account.configured === false) {
        return cachedResult('平台尚未設定 Insights 憑證；以下為最近一次已保存資料。')
          || { ...base, status: 'not_configured', data: [] };
      }

      const resolver = resolverFor(account.platformId, {
        resolveFacebookInsights,
        resolveInstagramInsights,
        resolveThreadsInsights,
      });
      if (typeof resolver !== 'function') {
        return cachedResult('此平台尚未接入 Insights；以下為最近一次已保存資料。')
          || {
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
          return cachedResult('平台尚未設定 Insights 憑證；以下為最近一次已保存資料。')
            || { ...base, status: 'not_configured', data: [] };
        }
        const payload = await insightsClient.fetchAccountInsights({
          since: request.query.since,
          until: request.query.until,
          metrics,
        });
        let snapshotError = null;
        try {
          await saveSnapshot({ ...base, ...payload });
        } catch (snapshotSaveError) {
          snapshotError = safeError(snapshotSaveError);
        }
        return { ...base, ...payload, status: 'synced', snapshotError };
      } catch (error) {
        return cachedResult(error?.message || '即時 Insights 同步失敗；以下為最近一次已保存資料。')
          || { ...base, status: 'error', data: [], error: safeError(error) };
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
