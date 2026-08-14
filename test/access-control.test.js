import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERMISSIONS,
  actorHasPermission,
  createActor,
  createLegacyOwnerActor,
  membershipId,
  requirePermission,
  roleHasPermission,
} from '../lib/access-control.js';
import {
  createInvitation,
  findInvitationByToken,
  listMembershipsForUser,
  upsertMembership,
  upsertUser,
} from '../lib/access-data.js';
import { appendAuditEvent } from '../lib/audit-log.js';

function memoryRepository(initial = []) {
  const records = initial.map((record) => ({ ...record }));
  return {
    async list() { return records.map((record) => ({ ...record })); },
    async getById(id) { return records.find((record) => record.id === id) || null; },
    async query({ filters = {}, limit = 0 } = {}) {
      const matches = records.filter((record) => Object.entries(filters)
        .every(([key, value]) => record[key] === value));
      return limit ? matches.slice(0, limit) : matches;
    },
    async create(record) { records.push({ ...record }); return { ...record }; },
    async update(id, updater) {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return null;
      records[index] = typeof updater === 'function'
        ? await updater({ ...records[index] })
        : { ...records[index], ...updater };
      records[index].id = id;
      return { ...records[index] };
    },
  };
}

function accessRepositories() {
  return {
    users: memoryRepository(),
    memberships: memoryRepository(),
    invitations: memoryRepository(),
    auditEvents: memoryRepository(),
  };
}

test('role permissions enforce separation between editors, reviewers, publishers and admins', () => {
  assert.equal(roleHasPermission('editor', 'content.edit'), true);
  assert.equal(roleHasPermission('editor', 'publish.execute'), false);
  assert.equal(roleHasPermission('reviewer', 'content.approve'), true);
  assert.equal(roleHasPermission('reviewer', 'content.edit'), false);
  assert.equal(roleHasPermission('publisher', 'publish.retry'), true);
  assert.equal(roleHasPermission('publisher', 'account.manage'), false);
  assert.equal(roleHasPermission('admin', 'member.manage'), true);
  assert.equal(roleHasPermission('admin', 'system.manage'), false);
  assert.ok(PERMISSIONS.includes('system.manage'));
});

test('actor access is scoped to active client memberships', () => {
  const actor = createActor({
    user: { uid: 'user-1', email: 'USER@example.com', status: 'active' },
    memberships: [
      { id: 'a', userId: 'user-1', clientId: 'client-a', role: 'editor', status: 'active' },
      { id: 'b', userId: 'user-1', clientId: 'client-b', role: 'publisher', status: 'revoked' },
    ],
  });
  assert.equal(actor.email, 'user@example.com');
  assert.equal(actorHasPermission(actor, 'content.edit', 'client-a'), true);
  assert.equal(actorHasPermission(actor, 'content.edit', 'client-b'), false);
  assert.equal(actorHasPermission(actor, 'content.view', 'client-c'), false);
  assert.equal(createLegacyOwnerActor().wildcardClientAccess, true);
  assert.equal(membershipId('client-a', 'user-1'), 'client-a__user-1');
});

test('permission middleware returns a stable denial and records authorized client scope', async () => {
  const middleware = requirePermission('publish.execute', {
    resolveClientId: async (request) => request.params.clientId,
  });
  const denied = {};
  await middleware({ actor: createActor({
    user: { uid: 'editor-1' },
    memberships: [{ userId: 'editor-1', clientId: 'client-a', role: 'editor', status: 'active' }],
  }), params: { clientId: 'client-a' } }, {
    status(code) { denied.status = code; return this; },
    json(body) { denied.body = body; return this; },
  }, () => { denied.next = true; });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'PERMISSION_DENIED');
  assert.equal(denied.next, undefined);

  const allowedRequest = {
    actor: createActor({
      user: { uid: 'publisher-1' },
      memberships: [{ userId: 'publisher-1', clientId: 'client-a', role: 'publisher', status: 'active' }],
    }),
    params: { clientId: 'client-a' },
  };
  let nextCalled = false;
  await middleware(allowedRequest, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(allowedRequest.authorizedClientId, 'client-a');
  assert.equal(allowedRequest.membership.role, 'publisher');
});

test('access data stores normalized users, memberships and hashed invitation tokens', async () => {
  const repositories = accessRepositories();
  const user = await upsertUser({ uid: 'user-1', email: ' User@Example.COM ', displayName: 'User' }, repositories);
  assert.equal(user.emailNormalized, 'user@example.com');
  const membership = await upsertMembership({
    clientId: 'client-a',
    userId: user.uid,
    role: 'editor',
    invitedBy: 'owner-1',
  }, repositories);
  assert.equal(membership.id, 'client-a__user-1');
  assert.equal((await listMembershipsForUser('user-1', repositories)).length, 1);

  const { invitation, token } = await createInvitation({
    email: 'Invitee@Example.com',
    grants: [{ clientId: 'client-a', role: 'viewer' }],
    invitedBy: 'owner-1',
  }, repositories, {
    now: () => Date.parse('2026-08-14T00:00:00.000Z'),
    tokenFactory: () => 'plain-invitation-token',
  });
  assert.equal(invitation.emailNormalized, 'invitee@example.com');
  assert.notEqual(invitation.tokenHash, token);
  assert.equal(JSON.stringify(await repositories.invitations.list()).includes(token), false);
  assert.equal((await findInvitationByToken(token, repositories)).id, invitation.id);
});

test('audit events derive actor identity and redact sensitive metadata', async () => {
  const repositories = accessRepositories();
  const event = await appendAuditEvent({
    actor: { uid: 'user-1', email: 'USER@example.com', type: 'user' },
    clientId: 'client-a',
    action: 'platform_account.updated',
    resourceType: 'platformAccount',
    resourceId: 'account-1',
    metadata: {
      changedFields: ['name', 'accessToken'],
      accessToken: 'must-not-be-saved',
      nested: { password: 'must-not-be-saved', status: 'connected' },
    },
  }, repositories);
  assert.equal(event.actorId, 'user-1');
  assert.equal(event.actorEmail, 'user@example.com');
  assert.equal(event.metadata.accessToken, undefined);
  assert.equal(event.metadata.nested.password, undefined);
  assert.equal(event.metadata.nested.status, 'connected');
});
