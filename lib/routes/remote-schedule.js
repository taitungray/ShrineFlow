import { Router } from 'express';
import { getClientRaw, listClientsRaw } from '../clients.js';
import { getRepositories } from '../repositories.js';
import { canAccessClient, requestedOrAccessibleClientId } from '../request-scope.js';

function unavailableSource(account, reason = 'connector_not_verified') {
  const configuredCapability = account.capabilities?.remote_schedule_read;
  return {
    accountId: account.id,
    platformId: account.platformId,
    status: 'remote_schedule_unavailable',
    source: 'meta_scheduled_posts_spike',
    capability: configuredCapability
      ? { ...configuredCapability, ...(configuredCapability.status === 'supported' ? { reason } : {}) }
      : { status: 'not_available', reason },
    data: [],
    paging: null,
  };
}

export function createRemoteScheduleRouter({
  resolveFacebookPublisher,
  getClient = getClientRaw,
  listClients = listClientsRaw,
  repositories = getRepositories(),
} = {}) {
  const router = Router();

  router.get('/remote-schedule', async (request, response) => {
    const clientId = requestedOrAccessibleClientId(request, request.query.clientId);
    const client = clientId
      ? await getClient(clientId)
      : (await listClients()).find((item) => canAccessClient(request, item.id));
    if (clientId && !client) return response.status(404).json({ error: '找不到品牌。' });
    if (!client) {
      return response.json({ status: 'remote_schedule_unavailable', clientId: '', sources: [] });
    }

    const accounts = (client.accounts || []).filter((account) => account.platformId === 'facebook');
    const sources = await Promise.all(accounts.map(async (account) => {
      const capability = account.capabilities?.remote_schedule_read;
      if (capability?.status !== 'supported') return unavailableSource(account, 'capability_not_verified');
      try {
        const publisher = await resolveFacebookPublisher?.({ clientId: client.id, accountId: account.id, account, client });
        if (typeof publisher?.listScheduledPosts !== 'function') return unavailableSource(account, 'connector_not_implemented');
        const payload = await publisher.listScheduledPosts({
          since: request.query.since,
          until: request.query.until,
          limit: request.query.limit,
          after: request.query.after,
        });
        return {
          accountId: account.id,
          platformId: account.platformId,
          status: 'synced',
          source: 'meta_scheduled_posts',
          data: Array.isArray(payload?.data) ? payload.data : [],
          paging: payload?.paging || null,
        };
      } catch (error) {
        return {
          accountId: account.id,
          platformId: account.platformId,
          status: 'remote_schedule_unavailable',
          source: 'meta_scheduled_posts_spike',
          data: [],
          paging: null,
          error: { message: error.message || 'Meta 遠端排程目前無法讀取。', code: error.code || 'REMOTE_SCHEDULE_UNAVAILABLE' },
        };
      }
    }));
    return response.json({
      status: sources.some((source) => source.status === 'synced') ? 'synced' : 'remote_schedule_unavailable',
      clientId: client.id,
      fetchedAt: new Date().toISOString(),
      sources,
    });
  });

  return router;
}
