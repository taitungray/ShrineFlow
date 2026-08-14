import { Router } from 'express';
import { findAccount, getClientRaw, listClientsRaw } from '../clients.js';
import {
  applyInboxItemMetadata,
  clearInboxSyncHint,
  getInboxCursor,
  getInboxSyncHint,
  INBOX_METADATA_POLICY,
  saveInboxCursor,
  updateInboxItemMetadata,
} from '../inbox-metadata.js';

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

function replyResolverFor(platformId, resolvers) {
  return {
    facebook: resolvers.resolveFacebookInbox,
    instagram: resolvers.resolveInstagramInbox,
    threads: resolvers.resolveThreadsInbox,
  }[platformId];
}

export function createInboxRouter({
  resolveFacebookInbox,
  resolveInstagramInbox,
  resolveThreadsInbox,
  getClient = getClientRaw,
  listClients = listClientsRaw,
} = {}) {
  const router = Router();

  router.post('/inbox/items/:itemId/reply', async (request, response) => {
    const clientId = String(request.body?.clientId || request.query.clientId || '').trim();
    const accountId = String(request.body?.accountId || request.query.accountId || '').trim();
    const platformId = String(request.body?.platformId || request.query.platform || '').trim();
    const text = String(request.body?.text || '').trim();
    if (!clientId || !accountId || !platformId || !text) {
      return response.status(400).json({ error: '回覆需要品牌、平台連線與文字內容。' });
    }
    if (text.length > 2000) return response.status(400).json({ error: '回覆文字最多 2,000 字。' });
    const client = await getClient(clientId);
    const account = findAccount(client, accountId);
    if (!client || !account) return response.status(404).json({ error: '找不到收件匣平台連線。' });
    const resolver = replyResolverFor(platformId, {
      resolveFacebookInbox,
      resolveInstagramInbox,
      resolveThreadsInbox,
    });
    if (typeof resolver !== 'function') {
      return response.status(501).json({ status: 'not_available', error: '此平台尚未提供回覆能力。' });
    }
    try {
      const inboxClient = await resolver({ clientId, accountId, account, client });
      if (!inboxClient?.configured || typeof inboxClient.reply !== 'function') {
        return response.status(501).json({ status: 'not_available', error: '此平台回覆需要額外權限或尚未接入。' });
      }
      const result = await inboxClient.reply({
        recipientId: request.body?.recipientId,
        replyToId: request.body?.replyToId || request.params.itemId,
        text,
      });
      response.status(201).json({ status: 'sent', itemId: request.params.itemId, ...result });
    } catch (error) {
      response.status(error.status || 502).json({ status: 'error', error: safeError(error) });
    }
  });

  router.patch('/inbox/items/:itemId', async (request, response) => {
    try {
      const metadata = await updateInboxItemMetadata({
        clientId: request.body?.clientId || request.query.clientId,
        accountId: request.body?.accountId || request.query.accountId,
        platformId: request.body?.platformId || request.query.platform,
        itemId: request.params.itemId,
      }, {
        ...(request.body?.unread === undefined ? {} : { unread: request.body.unread }),
        ...(request.body?.tags === undefined ? {} : { tags: request.body.tags }),
        ...(request.body?.note === undefined ? {} : { note: request.body.note }),
      });
      response.json({ itemId: request.params.itemId, metadata });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || '無法更新收件匣項目。' });
    }
  });

  router.get('/inbox', async (request, response) => {
    const requestedClientId = String(request.query.clientId || '').trim();
    const client = requestedClientId
      ? await getClient(requestedClientId)
      : (await listClients())[0];
    if (requestedClientId && !client) {
      return response.status(404).json({ error: '找不到品牌。' });
    }
    if (!client) {
      return response.json({
        status: 'unavailable',
        clientId: '',
        fetchedAt: null,
        retention: 'provider_backed',
        metadataPolicy: INBOX_METADATA_POLICY,
        sources: [],
      });
    }

    const requestedPlatform = String(request.query.platform || '').trim();
    const accountId = String(request.query.accountId || '').trim();
    const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 25));
    const explicitCursor = String(request.query.after || '').trim();
    const useSavedCursor = request.query.useCursor === 'true';
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
        const syncHint = await getInboxSyncHint(base);
        const savedCursor = await getInboxCursor(base);
        const payload = await inboxClient.fetchRecent({
          limit,
          after: explicitCursor || (!syncHint?.pending && useSavedCursor ? savedCursor?.value || '' : ''),
        });
        const items = await applyInboxItemMetadata(payload.items, base);
        const latestSyncHint = await getInboxSyncHint(base);
        const newerSyncPending = Boolean(
          latestSyncHint?.pending
          && (!syncHint?.pending || latestSyncHint.updatedAt !== syncHint.updatedAt),
        );
        const nextCursor = (!explicitCursor && newerSyncPending)
          ? ''
          : (payload.paging?.cursors?.after || '');
        if (nextCursor) await saveInboxCursor(base, nextCursor);
        else if (savedCursor) await saveInboxCursor(base, '');
        if (syncHint?.pending && !explicitCursor && !newerSyncPending) {
          await clearInboxSyncHint(base, syncHint.updatedAt);
        }
        const activeSyncHint = newerSyncPending ? latestSyncHint : syncHint;
        return {
          ...base,
          ...payload,
          items,
          status: 'synced',
          cursor: nextCursor ? { available: true, value: nextCursor } : null,
          syncPending: Boolean(activeSyncHint?.pending),
          syncHint: activeSyncHint?.pending ? {
            eventType: activeSyncHint.eventType,
            eventCount: activeSyncHint.eventCount,
            updatedAt: activeSyncHint.updatedAt,
          } : null,
        };
      } catch (error) {
        return { ...base, status: 'error', items: [], error: safeError(error) };
      }
    }));

    return response.json({
      status: overallStatus(sources),
      clientId: client.id,
      fetchedAt: new Date().toISOString(),
      retention: 'provider_backed',
      metadataPolicy: INBOX_METADATA_POLICY,
      sources,
    });
  });

  return router;
}
