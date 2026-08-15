import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { createActor } from '../lib/access-control.js';
import { createApiAuthorizationMiddleware, resolveApiAuthorizationRule } from '../lib/api-authorization.js';

function repository(records = []) {
  const values = records.map((record) => ({ ...record }));
  return {
    async list() { return values.map((record) => ({ ...record })); },
    async getById(id) { return values.find((record) => record.id === id) || null; },
    async create(record) { values.push({ ...record }); return record; },
  };
}

function actor(uid, memberships = [], systemRole = '') {
  return createActor({
    user: { uid, email: `${uid}@example.com`, systemRole },
    memberships: memberships.map(([clientId, role]) => ({
      id: `${clientId}__${uid}`,
      userId: uid,
      clientId,
      role,
      status: 'active',
    })),
    systemRole,
  });
}

test('API authorization derives scope from stored resources and hides cross-client records', async () => {
  const auditEvents = repository();
  const repositories = {
    posts: repository([{ id: 'post-a', clientId: 'client-a', targets: [{ id: 'target-a' }] }]),
    templates: repository(),
    campaigns: repository(),
    mediaAssets: repository(),
    notifications: { async list() { return { version: 1, items: [] }; } },
    auditEvents,
  };
  const actors = {
    editorA: actor('editor-a', [['client-a', 'editor']]),
    publisherA: actor('publisher-a', [['client-a', 'publisher']]),
    publisherB: actor('publisher-b', [['client-b', 'publisher']]),
    viewerA: actor('viewer-a', [['client-a', 'viewer']]),
    owner: actor('owner', [], 'owner'),
    brandOwner: actor('brand-owner', [['client-a', 'owner']]),
  };
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.actor = actors[request.get('X-Test-Actor')];
    next();
  });
  app.use('/api', createApiAuthorizationMiddleware({ repositories }));
  app.patch('/api/posts/:postId', (request, response) => response.json({
    clientId: request.authorizedClientId,
    bodyClientId: request.body.clientId,
  }));
  app.post('/api/publish/target', (request, response) => response.json({ ok: true }));
  app.get('/api/config', (request, response) => response.json({ clients: request.accessibleClientIds }));
  app.post('/api/settings', (_request, response) => response.json({ ok: true }));
  app.put('/api/clients/:clientId/accounts', (_request, response) => response.json({ ok: true }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const scoped = await fetch(`${baseUrl}/posts/post-a`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Test-Actor': 'editorA' },
      body: JSON.stringify({ clientId: 'client-b' }),
    });
    assert.equal(scoped.status, 200);
    assert.deepEqual(await scoped.json(), { clientId: 'client-a', bodyClientId: 'client-b' });

    const editorPublish = await fetch(`${baseUrl}/publish/target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Actor': 'editorA' },
      body: JSON.stringify({ postId: 'post-a' }),
    });
    assert.equal(editorPublish.status, 403);

    const crossClient = await fetch(`${baseUrl}/publish/target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Actor': 'publisherB' },
      body: JSON.stringify({ postId: 'post-a' }),
    });
    assert.equal(crossClient.status, 404);
    assert.equal((await crossClient.json()).code, 'RESOURCE_NOT_FOUND');

    const allowedPublish = await fetch(`${baseUrl}/publish/target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Actor': 'publisherA' },
      body: JSON.stringify({ postId: 'post-a' }),
    });
    assert.equal(allowedPublish.status, 200);

    const config = await fetch(`${baseUrl}/config`, { headers: { 'X-Test-Actor': 'viewerA' } });
    assert.deepEqual((await config.json()).clients, ['client-a']);

    const settingsDenied = await fetch(`${baseUrl}/settings`, {
      method: 'POST', headers: { 'X-Test-Actor': 'viewerA' },
    });
    assert.equal(settingsDenied.status, 403);
    const brandOwnerSettings = await fetch(`${baseUrl}/settings`, {
      method: 'POST', headers: { 'X-Test-Actor': 'brandOwner' },
    });
    assert.equal(brandOwnerSettings.status, 403);
    const settingsAllowed = await fetch(`${baseUrl}/settings`, {
      method: 'POST', headers: { 'X-Test-Actor': 'owner' },
    });
    assert.equal(settingsAllowed.status, 200);
    const ownerAccounts = await fetch(`${baseUrl}/clients/client-a/accounts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Test-Actor': 'owner' },
      body: JSON.stringify({ platformId: 'facebook' }),
    });
    assert.equal(ownerAccounts.status, 200);

    const unknownDenied = await fetch(`${baseUrl}/not-a-registered-route`, {
      method: 'POST', headers: { 'X-Test-Actor': 'editorA' },
    });
    assert.equal(unknownDenied.status, 403);
    assert.equal((await unknownDenied.json()).code, 'PERMISSION_DENIED');

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok((await auditEvents.list()).some((event) => event.action === 'publish.executed'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('settings mutations use distinct audit actions', () => {
  assert.equal(resolveApiAuthorizationRule({ method: 'POST', path: '/settings' }).action, 'system.settings_updated');
  assert.equal(resolveApiAuthorizationRule({ method: 'POST', path: '/settings/test-gemini' }).action, 'system.gemini_tested');
  assert.equal(resolveApiAuthorizationRule({ method: 'POST', path: '/settings/test-facebook' }).action, 'system.facebook_tested');
  assert.equal(resolveApiAuthorizationRule({ method: 'POST', path: '/settings/rotate-secrets' }).action, 'system.secrets_rotated');
  assert.equal(resolveApiAuthorizationRule({ method: 'GET', path: '/settings' }).action, '');
});
