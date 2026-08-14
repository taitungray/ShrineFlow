import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTH_COOKIE_NAME, AUTH_POLICY, createAuthMiddleware, createAuthService } from '../lib/auth.js';

test('single operator auth keeps bounded sessions and authenticates without storing plaintext tokens', () => {
  let current = 1_000;
  const auth = createAuthService({
    env: { SHRINEFLOW_OPERATOR_PASSWORD: 'correct horse', SHRINEFLOW_SESSION_SECRET: 'session-secret' },
    now: () => current,
  });
  const tokens = [];
  for (let index = 0; index < AUTH_POLICY.maxSessions + 1; index += 1) {
    tokens.push(auth.login({ password: 'correct horse', clientKey: `client-${index}` }).token);
  }
  assert.equal(auth.status(tokens[0]).authenticated, false);
  assert.equal(auth.status(tokens.at(-1)).authenticated, true);
  assert.equal(auth.policy.maxSessions, 4);
  assert.throws(() => auth.login({ password: 'wrong', clientKey: 'bad-client' }), /登入密碼不正確/);
});

test('single operator auth expires sessions and locks repeated bad passwords', () => {
  let current = 1_000;
  const auth = createAuthService({
    env: { SHRINEFLOW_OPERATOR_PASSWORD: 'correct', SHRINEFLOW_SESSION_SECRET: 'secret' },
    now: () => current,
  });
  for (let index = 0; index < AUTH_POLICY.maxLoginAttempts; index += 1) {
    assert.throws(() => auth.login({ password: 'wrong', clientKey: 'same-client' }));
  }
  assert.throws(
    () => auth.login({ password: 'correct', clientKey: 'same-client' }),
    (error) => error.code === 'AUTH_RATE_LIMITED' && error.status === 429,
  );
  const result = auth.login({ password: 'correct', clientKey: 'good-client' });
  assert.equal(auth.status(result.token).authenticated, true);
  current += AUTH_POLICY.sessionTtlMs + 1;
  assert.equal(auth.status(result.token).authenticated, false);
});

test('legacy auth middleware attaches an owner actor for gradual permission rollout', async () => {
  const auth = createAuthService({
    env: { SHRINEFLOW_OPERATOR_PASSWORD: 'correct', SHRINEFLOW_SESSION_SECRET: 'secret' },
  });
  const token = auth.login({ password: 'correct', clientKey: 'client' }).token;
  const request = { path: '/posts', headers: { cookie: `${AUTH_COOKIE_NAME}=${token}` } };
  let called = false;
  await createAuthMiddleware(auth)(request, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(request.actor.uid, 'legacy:operator');
  assert.equal(request.actor.systemRole, 'owner');
});
