import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decryptClientSecrets,
  decryptSecret,
  encryptClientSecrets,
  encryptSecret,
  isEncryptedSecret,
  secretStorageStatus,
} from '../lib/secret-storage.js';

test('AES-256-GCM secret storage encrypts and rejects the wrong master key', () => {
  const encrypted = encryptSecret('private-token', 'master-key');
  assert.equal(isEncryptedSecret(encrypted), true);
  assert.notEqual(encrypted.includes('private-token'), true);
  assert.equal(decryptSecret(encrypted, 'master-key'), 'private-token');
  assert.throws(() => decryptSecret(encrypted, 'wrong-key'), /Token 解密失敗/);
});

test('client secret transforms cover nested platform credentials without encrypting metadata', () => {
  const client = {
    id: 'client-1',
    tokenExpiresAt: '2026-09-01T00:00:00.000Z',
    accounts: [{ platformId: 'instagram', credentials: { userId: 'ig-1', accessToken: 'ig-secret' } }],
  };
  const encrypted = encryptClientSecrets(client, 'master-key');
  assert.equal(encrypted.tokenExpiresAt, client.tokenExpiresAt);
  assert.equal(isEncryptedSecret(encrypted.accounts[0].credentials.accessToken), true);
  assert.equal(decryptClientSecrets(encrypted, 'master-key').accounts[0].credentials.accessToken, 'ig-secret');
});

test('client secret transforms use the configured process master key by default', () => {
  const previous = process.env.SHRINEFLOW_MASTER_KEY;
  process.env.SHRINEFLOW_MASTER_KEY = 'process-master-key';
  try {
    const client = { accounts: [{ credentials: { accessToken: 'process-secret' } }] };
    const encrypted = encryptClientSecrets(client);
    assert.equal(isEncryptedSecret(encrypted.accounts[0].credentials.accessToken), true);
    assert.equal(decryptClientSecrets(encrypted).accounts[0].credentials.accessToken, 'process-secret');
  } finally {
    if (previous === undefined) delete process.env.SHRINEFLOW_MASTER_KEY;
    else process.env.SHRINEFLOW_MASTER_KEY = previous;
  }
});

test('settings writes encrypted environment secrets when a master key is configured', async () => {
  const previous = process.env.SHRINEFLOW_MASTER_KEY;
  process.env.SHRINEFLOW_MASTER_KEY = 'master-key';
  try {
    const { formatEnvContent } = await import('../lib/settings.js');
    const content = formatEnvContent({
      GEMINI_API_KEY: 'gemini-secret',
      FACEBOOK_PAGE_ACCESS_TOKEN: 'page-secret',
      META_APP_SECRET: 'app-secret',
      SHRINEFLOW_MASTER_KEY: 'master-key',
    });
    assert.doesNotMatch(content, /gemini-secret|page-secret|app-secret/);
    assert.match(content, /GEMINI_API_KEY=enc:v1:/);
    assert.equal(secretStorageStatus().configured, true);
  } finally {
    if (previous === undefined) delete process.env.SHRINEFLOW_MASTER_KEY;
    else process.env.SHRINEFLOW_MASTER_KEY = previous;
  }
});
