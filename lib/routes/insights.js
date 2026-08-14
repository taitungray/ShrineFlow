import { Router } from 'express';
import { getClientRaw, listClientsRaw } from '../clients.js';
import { readJson, jsonFiles } from '../store.js';
import { appendInsightsSnapshot, findLatestInsightsSnapshot } from '../insights-snapshots.js';
import { migrateLegacyPost } from '../post-targets.js';

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
  listPosts = async () => readJson(jsonFiles.posts, []),
  saveSnapshot = appendInsightsSnapshot,
  findSnapshot = findLatestInsightsSnapshot,
} = {}) {
  const router = Router();

  router.get('/insights', async (request, response) => {
    const scope = request.query.scope === 'posts' ? 'posts' : 'account';
    const requestedClientId = String(request.query.clientId || '').trim();
    const client = requestedClientId
      ? await getClient(requestedClientId)
      : (await listClients())[0];
    if (requestedClientId && !client) {
      return response.status(404).json({ error: '找不到品牌。' });
    }
    if (!client) {
      return response.json({ scope, status: 'unavailable', clientId: '', fetchedAt: null, sources: [] });
    }

    const platformId = String(request.query.platform || '').trim();
    const accountId = String(request.query.accountId || '').trim();
    const metrics = String(request.query.metrics || '').trim();
    const accounts = (client.accounts || []).filter((account) => (
      (!platformId || account.platformId === platformId)
      && (!accountId || account.id === accountId)
      && ['facebook', 'instagram', 'threads'].includes(account.platformId)
    ));

    if (scope === 'posts') {
      const posts = (await listPosts()).map((post) => migrateLegacyPost(post, post.clientId || client.id));
      const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 50);
      const targets = posts.flatMap((post) => (post.targets || []).map((target) => ({ post, target })))
        .filter(({ post, target }) => (
          (!post.clientId || post.clientId === client.id)
          && (!platformId || target.platformId === platformId)
          && (!accountId || target.accountId === accountId)
          && ['facebook', 'instagram', 'threads'].includes(target.platformId)
          && target.status === 'published'
        ))
        .sort((left, right) => new Date(right.target.publishedAt || right.post.updatedAt || 0)
          - new Date(left.target.publishedAt || left.post.updatedAt || 0))
        .slice(0, limit);
      const sources = await Promise.all(targets.map(async ({ post, target }) => {
        const account = (client.accounts || []).find((item) => item.id === target.accountId)
          || (client.accounts || []).find((item) => item.platformId === target.platformId);
        const base = {
          clientId: client.id,
          accountId: account?.id || target.accountId,
          accountName: account?.name || target.accountId || target.platformId,
          platformId: target.platformId,
          scope: 'post',
          postId: post.id,
          targetId: target.id,
          externalId: target.externalId || null,
          postTitle: post.contentTopic || post.godName || post.id,
          publishedAt: target.publishedAt || null,
        };
        const cached = await findSnapshot(base);
        const cachedResult = (errorMessage) => cached
          ? {
            ...base,
            status: 'cached',
            source: 'meta_graph_api_cached',
            fetchedAt: cached.fetchedAt,
            data: cached.data || [],
            paging: cached.paging || null,
            error: { message: errorMessage || '目前顯示最近一次已保存的貼文 Insights。', category: 'cached' },
          }
          : null;
        if (!account || account.enabled === false || account.configured === false) {
          return cachedResult('平台尚未設定貼文 Insights 憑證。') || {
            ...base,
            status: 'not_configured',
            data: [],
            error: { message: '平台尚未設定貼文 Insights 憑證。', category: 'authentication' },
          };
        }
        if (!target.externalId) {
          return cachedResult('此 target 沒有平台貼文 ID，無法查詢貼文成效。') || {
            ...base,
            status: 'not_available',
            data: [],
            error: { message: '此 target 沒有平台貼文 ID，無法查詢貼文成效。', category: 'missing_external_id' },
          };
        }
        const resolver = resolverFor(target.platformId, {
          resolveFacebookInsights,
          resolveInstagramInsights,
          resolveThreadsInsights,
        });
        try {
          const insightsClient = await resolver?.({
            clientId: client.id,
            accountId: account.id,
            account,
            client,
          });
          if (!insightsClient?.configured || typeof insightsClient.fetchPostInsights !== 'function') {
            return cachedResult('此平台尚未接入貼文 Insights。') || {
              ...base,
              status: 'not_available',
              data: [],
              error: { message: '此平台尚未接入貼文 Insights。', category: 'unsupported' },
            };
          }
          const payload = await insightsClient.fetchPostInsights({
            externalId: target.externalId,
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
          return cachedResult(error?.message || '貼文 Insights 同步失敗；以下為最近一次已保存資料。')
            || { ...base, status: 'error', data: [], error: safeError(error) };
        }
      }));
      return response.json({
        scope,
        status: overallStatus(sources),
        clientId: client.id,
        fetchedAt: new Date().toISOString(),
        sources,
      });
    }

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
