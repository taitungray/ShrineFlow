import { maskKey } from './settings.js';
import { makeId, mutateJson, readJson, jsonFiles } from './store.js';

export function findAccount(client, accountId) {
  if (!client?.accounts || !accountId) return null;
  return client.accounts.find((account) => account.id === accountId) || null;
}

export function maskAccountCredentials(credentials = {}) {
  const masked = { ...credentials };
  if (Object.prototype.hasOwnProperty.call(masked, 'pageAccessToken')) {
    masked.pageAccessToken = maskKey(masked.pageAccessToken);
  }
  if (Object.prototype.hasOwnProperty.call(masked, 'accessToken')) {
    masked.accessToken = maskKey(masked.accessToken);
  }
  return masked;
}

export function maskClient(client) {
  if (!client) return null;
  return {
    ...client,
    accounts: (client.accounts || []).map((account) => ({
      ...account,
      credentials: maskAccountCredentials(account.credentials || {}),
    })),
  };
}

export function buildDefaultClientFromEnv(env = {}, idFactory = makeId) {
  const pageId = String(env.FACEBOOK_PAGE_ID || '').trim();
  const pageAccessToken = String(env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim();
  if (!pageId && !pageAccessToken) return null;

  const configured = Boolean(pageId && pageAccessToken);
  return {
    id: idFactory(),
    name: '預設客戶',
    notes: '由既有 .env Facebook 設定自動建立',
    createdAt: new Date().toISOString(),
    accounts: [
      {
        id: pageId ? `facebook:${pageId}` : 'facebook:default',
        platformId: 'facebook',
        name: pageId ? `Facebook 粉專（${pageId}）` : 'Facebook 粉專（預設帳號）',
        enabled: true,
        configured,
        credentials: {
          pageId,
          pageAccessToken,
        },
      },
    ],
  };
}

export async function listClientsRaw() {
  return readJson(jsonFiles.clients, []);
}

export async function listClients() {
  const clients = await listClientsRaw();
  return clients.map(maskClient);
}

export async function getClientRaw(clientId) {
  const clients = await listClientsRaw();
  return clients.find((client) => client.id === clientId) || null;
}

export async function createClient({ name, notes = '' } = {}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('品牌名稱為必填。');

  const client = {
    id: makeId(),
    name: trimmedName,
    notes: String(notes || ''),
    createdAt: new Date().toISOString(),
    accounts: [],
  };

  await mutateJson(jsonFiles.clients, (clients) => {
    clients.push(client);
  });
  return maskClient(client);
}

export async function updateClient(clientId, { name, notes } = {}) {
  const updated = await mutateJson(jsonFiles.clients, (clients) => {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return null;
    if (name !== undefined) {
      const trimmedName = String(name || '').trim();
    if (!trimmedName) throw new Error('品牌名稱為必填。');
      client.name = trimmedName;
    }
    if (notes !== undefined) client.notes = String(notes || '');
    client.updatedAt = new Date().toISOString();
    return client;
  });
  return updated ? maskClient(updated) : null;
}

export function normalizeAccountInput(account = {}) {
  const platformId = String(account.platformId || '').trim();
  if (!platformId) throw new Error('platformId 為必填。');

  const credentials = { ...(account.credentials || {}) };
  const pageId = String(credentials.pageId || account.pageId || '').trim();
  if (pageId) credentials.pageId = pageId;
  const userId = String(credentials.userId || account.userId || '').trim();
  if (credentials.userId !== undefined || account.userId !== undefined) {
    credentials.userId = userId;
  }

  if (credentials.pageAccessToken !== undefined) {
    const token = String(credentials.pageAccessToken || '').trim();
    if (token.includes('...')) delete credentials.pageAccessToken;
    else credentials.pageAccessToken = token;
  }
  if (credentials.accessToken !== undefined) {
    const token = String(credentials.accessToken || '').trim();
    if (token.includes('...')) delete credentials.accessToken;
    else credentials.accessToken = token;
  }

  const id = String(account.id || '').trim()
    || (platformId === 'facebook' && pageId
      ? `facebook:${pageId}`
      : (['instagram', 'threads'].includes(platformId) && userId
        ? `${platformId}:${userId}`
        : `${platformId}:${makeId()}`));

  const hasToken = Boolean(credentials.pageAccessToken || credentials.accessToken);
  const requiresUserCredentials = platformId === 'instagram' || platformId === 'threads';
  const configured = requiresUserCredentials
    ? Boolean(userId && credentials.accessToken)
    : (account.configured !== undefined
      ? Boolean(account.configured)
      : (platformId === 'facebook'
        ? Boolean(pageId && credentials.pageAccessToken)
        : hasToken));

  return {
    id,
    platformId,
    name: String(account.name || `${platformId} 帳號`).trim(),
    enabled: account.enabled !== undefined ? Boolean(account.enabled) : true,
    configured,
    credentials,
  };
}

export async function upsertAccount(clientId, accountInput) {
  const nextAccount = normalizeAccountInput(accountInput);

  const updated = await mutateJson(jsonFiles.clients, (clients) => {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return null;
    if (!Array.isArray(client.accounts)) client.accounts = [];

    const index = client.accounts.findIndex((item) => item.id === nextAccount.id);
    if (index >= 0) {
      const previous = client.accounts[index];
      const mergedCredentials = { ...previous.credentials, ...nextAccount.credentials };
      if (!Object.prototype.hasOwnProperty.call(nextAccount.credentials, 'pageAccessToken')
        && previous.credentials?.pageAccessToken) {
        mergedCredentials.pageAccessToken = previous.credentials.pageAccessToken;
      }
      if (!Object.prototype.hasOwnProperty.call(nextAccount.credentials, 'accessToken')
        && previous.credentials?.accessToken) {
        mergedCredentials.accessToken = previous.credentials.accessToken;
      }
      const configured = nextAccount.platformId === 'facebook'
        ? Boolean(mergedCredentials.pageId && mergedCredentials.pageAccessToken)
        : (['instagram', 'threads'].includes(nextAccount.platformId)
          ? Boolean(mergedCredentials.userId && mergedCredentials.accessToken)
          : nextAccount.configured);
      client.accounts[index] = {
        ...previous,
        ...nextAccount,
        credentials: mergedCredentials,
        configured,
      };
    } else {
      client.accounts.push(nextAccount);
    }
    client.updatedAt = new Date().toISOString();
    return client;
  });

  return updated ? maskClient(updated) : null;
}

export async function ensureDefaultClientFromEnv(env = process.env) {
  return mutateJson(jsonFiles.clients, (clients) => {
    if (clients.length > 0) return clients[0];
    const created = buildDefaultClientFromEnv(env);
    if (!created) return null;
    clients.push(created);
    return created;
  });
}
