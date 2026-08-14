import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { createActor } from '../lib/access-control.js';
import { createApiAuthorizationMiddleware } from '../lib/api-authorization.js';
import { createAuthService } from '../lib/auth.js';
import { createInvitation, assertInvitationEmailAllowed } from '../lib/access-data.js';
import { pruneAuditEvents } from '../lib/audit-log.js';
import { createReauthService } from '../lib/reauth.js';
import { createSecurityMonitor } from '../lib/security-events.js';
import { createInvitationMailer } from '../lib/invitation-mailer.js';

function repository(initial = []) {
  const records = initial.map((record) => ({ ...record }));
  return {
    async list() { return records.map((record) => ({ ...record })); },
    async getById(id) { return records.find((record) => record.id === id) || null; },
    async create(record) { records.push({ ...record }); return { ...record }; },
    async replace(value) {
      records.splice(0, records.length, ...value.map((record) => ({ ...record })));
      return value;
    },
  };
}

test('reauthentication tokens are signed, short-lived and actor-bound', () => {
  let current = 1_000_000;
  const reauth = createReauthService({ secret: 'reauth-secret', now: () => current, ttlMs: 60_000 });
  const token = reauth.issue({ actorId: 'user-1' });
  assert.equal(reauth.verify(token, { actorId: 'user-1' }).actorId, 'user-1');
  assert.throws(() => reauth.verify(token, { actorId: 'user-2' }), (error) => error.code === 'REAUTH_REQUIRED');
  current += 60_001;
  assert.throws(() => reauth.verify(token, { actorId: 'user-1' }), (error) => error.code === 'REAUTH_REQUIRED');
});

test('legacy auth exposes password reauthentication without creating a second session', () => {
  const auth = createAuthService({
    env: { SHRINEFLOW_OPERATOR_PASSWORD: 'correct', SHRINEFLOW_SESSION_SECRET: 'secret' },
  });
  assert.deepEqual(auth.reauthenticate({ password: 'correct' }), { authenticated: true });
  assert.throws(() => auth.reauthenticate({ password: 'wrong' }), (error) => error.code === 'REAUTH_FAILED');
});

test('invitation email domains can be allowlisted or blocked', async () => {
  assert.equal(assertInvitationEmailAllowed('owner@example.com', {
    SHRINEFLOW_ALLOWED_EMAIL_DOMAINS: 'example.com',
  }), 'example.com');
  assert.throws(
    () => assertInvitationEmailAllowed('owner@other.test', { SHRINEFLOW_ALLOWED_EMAIL_DOMAINS: 'example.com' }),
    (error) => error.code === 'INVITATION_DOMAIN_NOT_ALLOWED',
  );
  assert.throws(
    () => assertInvitationEmailAllowed('owner@blocked.test', { SHRINEFLOW_BLOCKED_EMAIL_DOMAINS: 'blocked.test' }),
    (error) => error.code === 'INVITATION_DOMAIN_BLOCKED',
  );

  const repositories = { invitations: repository() };
  await assert.rejects(
    () => createInvitation({
      email: 'owner@other.test',
      grants: [{ clientId: 'client-a', role: 'editor' }],
    }, repositories, { env: { SHRINEFLOW_ALLOWED_EMAIL_DOMAINS: 'example.com' } }),
    (error) => error.code === 'INVITATION_DOMAIN_NOT_ALLOWED',
  );
});

test('audit retention removes expired and over-capacity events', async () => {
  const now = Date.parse('2026-08-14T00:00:00.000Z');
  const repositories = {
    auditEvents: repository([
      { id: 'old', createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 'new-1', createdAt: '2026-08-13T00:00:00.000Z' },
      { id: 'new-2', createdAt: '2026-08-12T00:00:00.000Z' },
      { id: 'new-3', createdAt: '2026-08-11T00:00:00.000Z' },
    ]),
  };
  const result = await pruneAuditEvents({ repositories, now: () => now, retentionDays: 30, maxRecords: 2 });
  assert.equal(result.removed, 2);
  assert.deepEqual((await repositories.auditEvents.list()).map((event) => event.id), ['new-1', 'new-2']);
});

test('security monitor emits an anomaly event after repeated failures', async () => {
  const repositories = { auditEvents: repository() };
  const monitor = createSecurityMonitor({
    repositories,
    now: () => 1_000_000,
    threshold: 2,
    windowMs: 60_000,
  });
  await monitor.record({ type: 'login_failed', ip: '203.0.113.10' });
  await monitor.record({ type: 'login_failed', ip: '203.0.113.10' });
  const actions = (await repositories.auditEvents.list()).map((event) => event.action);
  assert.ok(actions.includes('security.login_failed'));
  assert.ok(actions.includes('security.anomaly_detected'));
});

test('high-risk API operations require a recent actor-bound reauthentication token', async () => {
  const repositories = {
    auditEvents: repository(),
    posts: repository(),
    templates: repository(),
    campaigns: repository(),
    mediaAssets: repository(),
    notifications: { async list() { return { items: [] }; } },
  };
  const actor = createActor({
    user: { uid: 'owner-1', email: 'owner@example.com', status: 'active' },
    memberships: [],
    systemRole: 'owner',
  });
  const reauth = createReauthService({
    secret: 'reauth-secret',
    required: true,
    now: () => 1_000_000,
  });
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.actor = actor;
    next();
  });
  app.use('/api', createApiAuthorizationMiddleware({ repositories, reauthService: reauth }));
  app.post('/api/settings', (_request, response) => response.json({ ok: true }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const denied = await fetch(`${baseUrl}/settings`, { method: 'POST' });
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).code, 'REAUTH_REQUIRED');
    const token = reauth.issue({ actorId: actor.uid });
    const accepted = await fetch(`${baseUrl}/settings`, {
      method: 'POST',
      headers: { 'X-Reauth-Token': token },
    });
    assert.equal(accepted.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('invitation mailer uses a configured webhook without exposing bearer credentials in the payload', async () => {
  let request;
  const mailer = createInvitationMailer({
    env: {
      SHRINEFLOW_INVITATION_EMAIL_WEBHOOK_URL: 'https://mailer.example.test/invitations',
      SHRINEFLOW_INVITATION_EMAIL_WEBHOOK_TOKEN: 'webhook-secret',
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202 };
    },
  });
  const result = await mailer.send({
    email: 'owner@example.com',
    invitationUrl: 'https://app.example.test/?invite=one-time',
    grants: [{ clientId: 'client-a', role: 'editor' }],
  });
  assert.deepEqual(result, { enabled: true, delivered: true });
  assert.equal(request.url, 'https://mailer.example.test/invitations');
  assert.equal(request.options.headers.Authorization, 'Bearer webhook-secret');
  assert.equal(request.options.body.includes('webhook-secret'), false);
  assert.equal(JSON.parse(request.options.body).to, 'owner@example.com');
});
