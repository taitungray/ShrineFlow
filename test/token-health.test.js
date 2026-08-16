import test from 'node:test';
import assert from 'node:assert/strict';

import { accountHealthMessage, getTokenHealth } from '../lib/token-health.js';

const NOW = Date.parse('2026-08-14T00:00:00.000Z');

test('token health distinguishes valid, expiring, expired and unknown dates', () => {
  assert.equal(getTokenHealth({ configured: true, tokenExpiresAt: '2026-09-01T00:00:00.000Z' }, NOW).status, 'valid');
  const expiring = getTokenHealth({ configured: true, tokenExpiresAt: '2026-08-20T00:00:00.000Z' }, NOW);
  assert.equal(expiring.status, 'expiring');
  assert.equal(expiring.expiresInDays, 6);
  assert.equal(getTokenHealth({ configured: true, tokenExpiresAt: '2026-08-13T00:00:00.000Z' }, NOW).status, 'expired');
  const unknown = getTokenHealth({ configured: true }, NOW);
  assert.equal(unknown.status, 'unknown');
  assert.equal(accountHealthMessage(unknown), '到期日未填（可留白）');
});

test('unconfigured accounts are not reported as unknown configured tokens', () => {
  const health = getTokenHealth({ configured: false });
  assert.equal(health.status, 'not_configured');
  assert.equal(accountHealthMessage(health), '尚未設定 Token');
});
