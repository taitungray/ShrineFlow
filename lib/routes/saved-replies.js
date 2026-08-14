import { Router } from 'express';
import { listClientsRaw } from '../clients.js';
import { makeId } from '../store.js';
import { getRepositories } from '../repositories.js';
import { assertCollectionCapacity } from '../storage-policy.js';
import { filterAccessibleClients, requestedOrAccessibleClientId } from '../request-scope.js';

const MAX_TITLE_LENGTH = 80;
const MAX_SHORTCUT_LENGTH = 40;
const MAX_TEXT_LENGTH = 2000;

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function present(reply) {
  return {
    ...reply,
    title: normalizeText(reply.title, MAX_TITLE_LENGTH),
    shortcut: normalizeText(reply.shortcut, MAX_SHORTCUT_LENGTH),
    text: normalizeText(reply.text, MAX_TEXT_LENGTH),
    sortOrder: Number(reply.sortOrder) || 0,
  };
}

function normalizeBody(body = {}, current = {}) {
  return {
    ...current,
    title: normalizeText(body.title ?? current.title, MAX_TITLE_LENGTH),
    shortcut: normalizeText(body.shortcut ?? current.shortcut, MAX_SHORTCUT_LENGTH),
    text: normalizeText(body.text ?? current.text, MAX_TEXT_LENGTH),
    sortOrder: Number.isFinite(Number(body.sortOrder ?? current.sortOrder))
      ? Number(body.sortOrder ?? current.sortOrder)
      : 0,
  };
}

async function defaultClientId(listClients) {
  const clients = await listClients();
  return clients[0]?.id || '';
}

export function createSavedRepliesRouter({
  repositories = getRepositories(),
  listClients = listClientsRaw,
} = {}) {
  const router = Router();

  router.get('/saved-replies', async (request, response) => {
    const fallbackClientId = await defaultClientId(listClients);
    const clientId = requestedOrAccessibleClientId(request, request.query.clientId, fallbackClientId);
    const replies = await repositories.savedReplies.list();
    response.json(filterAccessibleClients(replies, request, clientId)
      .map(present)
      .sort((left, right) => left.sortOrder - right.sortOrder
        || new Date(left.updatedAt || left.createdAt || 0) - new Date(right.updatedAt || right.createdAt || 0)));
  });

  router.post('/saved-replies', async (request, response) => {
    const fallbackClientId = await defaultClientId(listClients);
    const clientId = requestedOrAccessibleClientId(request, request.body?.clientId, fallbackClientId);
    const next = normalizeBody(request.body || {});
    if (!clientId) return response.status(400).json({ error: '請先建立品牌再儲存 Saved reply。' });
    if (!next.title || !next.text) return response.status(400).json({ error: 'Saved reply 需要標題與文字。' });
    const now = new Date().toISOString();
    const created = { ...next, id: makeId(), clientId, createdAt: now, updatedAt: now };
    await repositories.savedReplies.mutate((replies) => {
      assertCollectionCapacity('savedReplies', replies.length, 1);
      replies.push(created);
    });
    response.status(201).json(present(created));
  });

  router.patch('/saved-replies/:replyId', async (request, response) => {
    const updated = await repositories.savedReplies.mutate((replies) => {
      const index = replies.findIndex((reply) => reply.id === request.params.replyId);
      if (index < 0) return null;
      const current = replies[index];
      const next = normalizeBody(request.body || {}, current);
      if (!next.title || !next.text) return null;
      replies[index] = {
        ...next,
        id: current.id,
        clientId: current.clientId,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      return replies[index];
    });
    if (!updated) return response.status(404).json({ error: '找不到 Saved reply 或內容不可為空。' });
    response.json(present(updated));
  });

  router.delete('/saved-replies/:replyId', async (request, response) => {
    const deleted = await repositories.savedReplies.mutate((replies) => {
      const index = replies.findIndex((reply) => reply.id === request.params.replyId);
      if (index < 0) return null;
      return replies.splice(index, 1)[0];
    });
    if (!deleted) return response.status(404).json({ error: '找不到 Saved reply。' });
    response.json({ ok: true, id: deleted.id });
  });

  return router;
}
