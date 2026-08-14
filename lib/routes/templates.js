import { Router } from 'express';
import { listClientsRaw } from '../clients.js';
import { makeId } from '../store.js';
import { getRepositories } from '../repositories.js';
import { assertCollectionCapacity } from '../storage-policy.js';
import { filterAccessibleClients, requestedOrAccessibleClientId } from '../request-scope.js';

const ALLOWED_POST_TYPES = new Set(['intro', 'announcement']);
const ALLOWED_PLATFORMS = new Set(['facebook', 'instagram', 'threads']);

async function defaultClientId() {
  const clients = await listClientsRaw();
  return clients[0]?.id || '';
}

function normalizeHashtags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizePlatforms(value) {
  if (!Array.isArray(value)) return ['facebook'];
  const unique = [...new Set(value.map((item) => String(item).trim()).filter((item) => ALLOWED_PLATFORMS.has(item)))];
  return unique.length ? unique : ['facebook'];
}

function presentTemplate(template) {
  return {
    ...template,
    hashtags: normalizeHashtags(template.hashtags),
    platforms: normalizePlatforms(template.platforms),
    postType: ALLOWED_POST_TYPES.has(template.postType) ? template.postType : 'intro',
  };
}

function normalizeBody(body = {}, current = {}) {
  return {
    ...current,
    name: String(body.name ?? current.name ?? '').trim(),
    purpose: String(body.purpose ?? current.purpose ?? '').trim(),
    topicHint: String(body.topicHint ?? current.topicHint ?? '').trim(),
    postType: ALLOWED_POST_TYPES.has(body.postType) ? body.postType : (current.postType || 'intro'),
    hashtags: normalizeHashtags(body.hashtags ?? current.hashtags),
    notes: String(body.notes ?? current.notes ?? '').trim(),
    defaultCallToAction: String(body.defaultCallToAction ?? current.defaultCallToAction ?? '').trim(),
    platforms: normalizePlatforms(body.platforms ?? current.platforms),
  };
}

export function createTemplatesRouter({ repositories = getRepositories() } = {}) {
  const router = Router();

  router.get('/templates', async (request, response) => {
    const clientId = String(request.query.clientId || '').trim();
    const fallbackClientId = await defaultClientId();
    const templates = await repositories.templates.list();
    response.json(filterAccessibleClients(templates, request, clientId)
      .map(presentTemplate)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)));
  });

  router.post('/templates', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const body = request.body || {};
    const clientId = requestedOrAccessibleClientId(request, body.clientId, fallbackClientId);
    const template = normalizeBody(body);
    if (!clientId) return response.status(400).json({ error: '請先建立品牌再儲存模板。' });
    if (!template.name) return response.status(400).json({ error: '請填寫模板名稱。' });
    const now = new Date().toISOString();
    const created = {
      ...template,
      id: makeId(),
      clientId,
      createdAt: now,
      updatedAt: now,
    };
    await repositories.templates.mutate((templates) => {
      assertCollectionCapacity('templates', templates.length, 1);
      templates.push(created);
    });
    response.status(201).json(presentTemplate(created));
  });

  router.patch('/templates/:templateId', async (request, response) => {
    const updated = await repositories.templates.mutate((templates) => {
      const index = templates.findIndex((template) => template.id === request.params.templateId);
      if (index < 0) return null;
      const current = templates[index];
      const next = normalizeBody(request.body || {}, current);
      if (!next.name) return null;
      next.id = current.id;
      next.clientId = current.clientId;
      next.createdAt = current.createdAt;
      next.updatedAt = new Date().toISOString();
      templates[index] = next;
      return next;
    });
    if (!updated) return response.status(404).json({ error: '找不到模板或模板名稱不可為空。' });
    response.json(presentTemplate(updated));
  });

  router.delete('/templates/:templateId', async (request, response) => {
    const deleted = await repositories.templates.mutate((templates) => {
      const index = templates.findIndex((template) => template.id === request.params.templateId);
      if (index < 0) return null;
      return templates.splice(index, 1)[0];
    });
    if (!deleted) return response.status(404).json({ error: '找不到模板。' });
    response.json({ ok: true, id: deleted.id });
  });

  return router;
}
