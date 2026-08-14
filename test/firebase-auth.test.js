import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { createInvitation } from '../lib/access-data.js';
import { createAuthRouter } from '../lib/auth.js';
import { createFirebaseSessionAuthService } from '../lib/firebase-auth.js';

function memoryRepository(initial = []) {
  const records = initial.map((record) => ({ ...record }));
  return {
    async list() { return records.map((record) => ({ ...record })); },
    async getById(id) { return records.find((record) => record.id === id) || null; },
    async query({ filters = {}, limit = 0 } = {}) {
      const result = records.filter((record) => Object.entries(filters)
        .every(([key, value]) => record[key] === value));
      return limit ? result.slice(0, limit) : result;
    },
    async create(record) {
      if (records.some((item) => item.id === record.id)) throw new Error('duplicate');
      records.push({ ...record });
      return { ...record };
    },
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

function repositoriesWithClients() {
  return {
    clients: memoryRepository([
      { id: 'client-a', name: 'Brand A' },
      { id: 'client-b', name: 'Brand B' },
    ]),
    users: memoryRepository(),
    memberships: memoryRepository(),
    invitations: memoryRepository(),
    auditEvents: memoryRepository(),
  };
}

function fakeFirebaseAuth() {
  const revoked = [];
  return {
    revoked,
    async verifyIdToken(idToken) {
      if (idToken === 'owner-token') return {
        uid: 'owner-1',
        email: 'owner@example.com',
        email_verified: true,
        name: 'Owner',
        firebase: { sign_in_provider: 'google.com' },
      };
      if (idToken === 'invitee-token') return {
        uid: 'user-2',
        email: 'invitee@example.com',
        email_verified: true,
        name: 'Invitee',
        firebase: { sign_in_provider: 'google.com' },
      };
      if (idToken === 'unknown-token') return {
        uid: 'unknown-1',
        email: 'unknown@example.com',
        email_verified: true,
      };
      throw new Error('invalid token');
    },
    async createSessionCookie(idToken) { return `session:${idToken}`; },
    async verifySessionCookie(sessionCookie) {
      if (sessionCookie === 'session:owner-token') return { uid: 'owner-1', exp: 1800000000 };
      if (sessionCookie === 'session:invitee-token') return { uid: 'user-2', exp: 1800000000 };
      throw new Error('invalid session');
    },
    async revokeRefreshTokens(uid) { revoked.push(uid); },
  };
}

test('Firebase owner allowlist bootstraps owner memberships and authenticates the server session', async () => {
  const repositories = repositoriesWithClients();
  const firebaseAuth = fakeFirebaseAuth();
  const service = createFirebaseSessionAuthService({
    firebaseAuth,
    repositories,
    env: { SHRINEFLOW_OWNER_EMAILS: 'owner@example.com', FIREBASE_PROJECT_ID: 'demo' },
    now: () => Date.parse('2026-08-14T00:00:00.000Z'),
  });
  const result = await service.createSession({ idToken: 'owner-token' });
  assert.equal(result.token, 'session:owner-token');
  assert.equal(result.actor.systemRole, 'owner');
  assert.deepEqual(result.actor.memberships.map((item) => item.clientId).sort(), ['client-a', 'client-b']);
  assert.equal((await repositories.users.getById('owner-1')).systemRole, 'owner');
  assert.equal((await service.authenticate(result.token)).actor.uid, 'owner-1');
  await repositories.users.update('owner-1', { status: 'suspended' });
  assert.equal(await service.authenticate(result.token), null);
  await service.revokeSessions('owner-1');
  assert.deepEqual(firebaseAuth.revoked, ['owner-1']);
});

test('Firebase sign-in rejects unknown users and accepts a matching one-time invitation', async () => {
  const repositories = repositoriesWithClients();
  const service = createFirebaseSessionAuthService({
    firebaseAuth: fakeFirebaseAuth(),
    repositories,
    env: { FIREBASE_PROJECT_ID: 'demo' },
    now: () => Date.parse('2026-08-14T00:00:00.000Z'),
  });
  await assert.rejects(
    () => service.createSession({ idToken: 'unknown-token' }),
    (error) => error.code === 'AUTH_NOT_INVITED' && error.status === 403,
  );
  const { token } = await createInvitation({
    email: 'invitee@example.com',
    grants: [{ clientId: 'client-a', role: 'editor' }],
    invitedBy: 'owner-1',
  }, repositories, {
    now: () => Date.parse('2026-08-14T00:00:00.000Z'),
    tokenFactory: () => 'invite-token',
  });
  const result = await service.createSession({ idToken: 'invitee-token', inviteToken: token });
  assert.equal(result.actor.memberships[0].role, 'editor');
  assert.equal((await repositories.invitations.list())[0].status, 'accepted');
  assert.equal((await service.authenticate(result.token)).actor.uid, 'user-2');
});

test('Firebase auth router requires double-submit CSRF before creating a session cookie', async () => {
  const authService = {
    enabled: true,
    mode: 'firebase',
    webConfig: { projectId: 'demo' },
    async status() { return { enabled: true, authenticated: false, mode: 'firebase' }; },
    async createSession() {
      return {
        token: 'firebase-session-cookie',
        expiresAt: '2026-08-14T12:00:00.000Z',
        actor: { uid: 'user-1', email: 'user@example.com', memberships: [] },
      };
    },
    async logout() {},
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createAuthRouter({ authService }));
  const server = app.listen(0);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const csrfResponse = await fetch(`${baseUrl}/auth/csrf`);
    const { csrfToken } = await csrfResponse.json();
    const csrfCookie = csrfResponse.headers.get('set-cookie').split(';')[0];

    const denied = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'id-token' }),
    });
    assert.equal(denied.status, 403);

    const accepted = await fetch(`${baseUrl}/auth/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: csrfCookie,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ idToken: 'id-token' }),
    });
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get('set-cookie'), /shrineflow_session=firebase-session-cookie/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
