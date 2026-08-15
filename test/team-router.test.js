import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { createActor } from '../lib/access-control.js';
import { createTeamRouter } from '../lib/routes/team.js';

function repository(initial = []) {
  const records = initial.map((record) => ({ ...record }));
  return {
    async list() { return records.map((record) => ({ ...record })); },
    async getById(id) { return records.find((record) => record.id === id) || null; },
    async query({ filters = {} } = {}) {
      return records.filter((record) => Object.entries(filters).every(([key, value]) => record[key] === value));
    },
    async create(record) { records.push({ ...record }); return { ...record }; },
    async update(id, updater) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return null;
      const next = typeof updater === 'function' ? await updater({ ...records[index] }) : { ...records[index], ...updater };
      records[index] = { ...next, id };
      return { ...records[index] };
    },
  };
}

function membership(clientId, userId, role, status = 'active') {
  return {
    id: `${clientId}__${userId}`,
    clientId,
    userId,
    role,
    status,
    invitedBy: 'bootstrap',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  };
}

function actor(uid, memberships, systemRole = '') {
  return createActor({ user: { uid, email: `${uid}@example.com`, status: 'active' }, memberships, systemRole });
}

test('team router enforces owner continuity, invitation safety and scoped audit access', async () => {
  const memberships = [
    membership('client-a', 'owner-1', 'owner'),
    membership('client-a', 'owner-2', 'owner'),
    membership('client-a', 'admin-1', 'admin'),
  ];
  const repositories = {
    clients: repository([{ id: 'client-a', name: 'A' }, { id: 'client-b', name: 'B' }]),
    users: repository([
      { id: 'owner-1', uid: 'owner-1', email: 'owner-1@example.com', status: 'active' },
      { id: 'owner-2', uid: 'owner-2', email: 'owner-2@example.com', status: 'active' },
      { id: 'admin-1', uid: 'admin-1', email: 'admin-1@example.com', status: 'active' },
    ]),
    memberships: repository(memberships),
    invitations: repository(),
    auditEvents: repository([
      { id: 'event-a', clientId: 'client-a', action: 'post.updated', actorId: 'owner-1', createdAt: '2026-08-14T02:00:00.000Z' },
      { id: 'event-b', clientId: 'client-b', action: 'post.updated', actorId: 'other', createdAt: '2026-08-14T03:00:00.000Z' },
      { id: 'event-global', clientId: null, action: 'settings.updated', actorId: 'other', createdAt: '2026-08-14T04:00:00.000Z' },
    ]),
  };
  const actors = {
    owner: actor('owner-1', memberships, 'owner'),
    admin: actor('admin-1', memberships),
  };
  const revokedSessions = [];
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.actor = actors[request.get('X-Test-Actor')];
    next();
  });
  app.use('/api', createTeamRouter({
    repositories,
    authService: { async revokeSessions(uid) { revokedSessions.push(uid); } },
  }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const adminOwnerEdit = await fetch(`${baseUrl}/clients/client-a/members/owner-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Test-Actor': 'admin' },
      body: JSON.stringify({ role: 'editor' }),
    });
    assert.equal(adminOwnerEdit.status, 403);
    assert.equal((await adminOwnerEdit.json()).code, 'OWNER_ROLE_REQUIRED');

    const firstRemoval = await fetch(`${baseUrl}/clients/client-a/members/owner-2`, {
      method: 'DELETE', headers: { 'X-Test-Actor': 'owner' },
    });
    assert.equal(firstRemoval.status, 200);
    assert.deepEqual(revokedSessions, ['owner-2']);

    const lastOwnerRemoval = await fetch(`${baseUrl}/clients/client-a/members/owner-1`, {
      method: 'DELETE', headers: { 'X-Test-Actor': 'owner' },
    });
    assert.equal(lastOwnerRemoval.status, 409);
    assert.equal((await lastOwnerRemoval.json()).code, 'LAST_OWNER_REQUIRED');

    const invitationResponse = await fetch(`${baseUrl}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Actor': 'owner' },
      body: JSON.stringify({ email: 'new@example.com', grants: [{ clientId: 'client-a', role: 'editor' }] }),
    });
    assert.equal(invitationResponse.status, 201);
    const invitationBody = await invitationResponse.json();
    assert.ok(invitationBody.invitationToken);
    assert.ok(invitationBody.invitationUrl.includes('?invite='));
    assert.equal(invitationBody.invitation.tokenHash, undefined);
    assert.notEqual((await repositories.invitations.list())[0].tokenHash, invitationBody.invitationToken);

    const auditResponse = await fetch(`${baseUrl}/audit-events?clientId=client-a`, {
      headers: { 'X-Test-Actor': 'admin' },
    });
    assert.equal(auditResponse.status, 200);
    const eventIds = (await auditResponse.json()).events.map((event) => event.id);
    assert.ok(eventIds.includes('event-a'));
    assert.equal(eventIds.includes('event-b'), false);
    assert.equal(eventIds.includes('event-global'), false);

    const ownerAudit = await fetch(`${baseUrl}/audit-events?clientId=client-a`, {
      headers: { 'X-Test-Actor': 'owner' },
    });
    assert.equal(ownerAudit.status, 200);
    const ownerEventIds = (await ownerAudit.json()).events.map((event) => event.id);
    assert.ok(ownerEventIds.includes('event-a'));
    assert.ok(ownerEventIds.includes('event-global'));
    assert.equal(ownerEventIds.includes('event-b'), false);

    const exportResponse = await fetch(`${baseUrl}/audit-events/export?clientId=client-a`, {
      headers: { 'X-Test-Actor': 'admin' },
    });
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-type'), /text\/csv/);
    const exportBody = await exportResponse.text();
    assert.match(exportBody, /event-a/);
    assert.equal(exportBody.includes('event-b'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
