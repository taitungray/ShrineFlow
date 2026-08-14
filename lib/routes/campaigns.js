import { Router } from 'express';
import { listClientsRaw } from '../clients.js';
import { makeId } from '../store.js';
import { getRepositories } from '../repositories.js';
import { assertCollectionCapacity } from '../storage-policy.js';
import { filterAccessibleClients, requestedOrAccessibleClientId } from '../request-scope.js';

const CAMPAIGN_STATUSES = new Set(['planned', 'active', 'completed', 'archived']);

async function defaultClientId() {
  const clients = await listClientsRaw();
  return clients[0]?.id || '';
}

function normalizePostIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeBody(body = {}, current = {}) {
  const startDate = String(body.startDate ?? current.startDate ?? '').trim();
  const endDate = String(body.endDate ?? current.endDate ?? '').trim();
  return {
    ...current,
    name: String(body.name ?? current.name ?? '').trim(),
    objective: String(body.objective ?? current.objective ?? '').trim(),
    startDate,
    endDate,
    description: String(body.description ?? current.description ?? '').trim(),
    status: CAMPAIGN_STATUSES.has(body.status) ? body.status : (current.status || 'planned'),
    postIds: normalizePostIds(body.postIds ?? current.postIds),
  };
}

function presentCampaign(campaign) {
  return { ...campaign, postIds: normalizePostIds(campaign.postIds) };
}

export function createCampaignsRouter({ repositories = getRepositories() } = {}) {
  const router = Router();

  router.get('/campaigns', async (request, response) => {
    const clientId = String(request.query.clientId || '').trim();
    const campaigns = await repositories.campaigns.list();
    response.json(filterAccessibleClients(campaigns, request, clientId)
      .map(presentCampaign)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)));
  });

  router.post('/campaigns', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const body = request.body || {};
    const clientId = requestedOrAccessibleClientId(request, body.clientId, fallbackClientId);
    const campaign = normalizeBody(body);
    if (!clientId) return response.status(400).json({ error: '請先建立品牌再儲存活動。' });
    if (!campaign.name) return response.status(400).json({ error: '請填寫活動名稱。' });
    if (campaign.startDate && campaign.endDate && campaign.startDate > campaign.endDate) {
      return response.status(400).json({ error: '活動結束日期不可早於開始日期。' });
    }
    const now = new Date().toISOString();
    const created = {
      ...campaign,
      id: makeId(),
      clientId,
      createdAt: now,
      updatedAt: now,
    };
    await repositories.campaigns.mutate((campaigns) => {
      assertCollectionCapacity('campaigns', campaigns.length, 1);
      campaigns.push(created);
    });
    response.status(201).json(presentCampaign(created));
  });

  router.patch('/campaigns/:campaignId', async (request, response) => {
    const updated = await repositories.campaigns.mutate((campaigns) => {
      const index = campaigns.findIndex((campaign) => campaign.id === request.params.campaignId);
      if (index < 0) return null;
      const current = campaigns[index];
      const next = normalizeBody(request.body || {}, current);
      if (!next.name || (next.startDate && next.endDate && next.startDate > next.endDate)) return null;
      next.id = current.id;
      next.clientId = current.clientId;
      next.createdAt = current.createdAt;
      next.updatedAt = new Date().toISOString();
      campaigns[index] = next;
      return next;
    });
    if (!updated) return response.status(404).json({ error: '找不到活動，或活動資料不完整。' });
    response.json(presentCampaign(updated));
  });

  router.delete('/campaigns/:campaignId', async (request, response) => {
    const deleted = await repositories.campaigns.mutate((campaigns) => {
      const index = campaigns.findIndex((campaign) => campaign.id === request.params.campaignId);
      if (index < 0) return null;
      return campaigns.splice(index, 1)[0];
    });
    if (!deleted) return response.status(404).json({ error: '找不到活動。' });
    response.json({ ok: true, id: deleted.id });
  });

  return router;
}
