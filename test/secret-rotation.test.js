import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  decryptEnvironmentSecrets,
  parseEnvContent,
  rotateEnvironmentContent,
} from '../lib/settings.js';
import { encryptSecret, isEncryptedSecret } from '../lib/secret-storage.js';
import { createSettingsRouter } from '../lib/routes/settings.js';

test('environment secret rotation decrypts with the old key and encrypts with the new key', () => {
  const oldKey = 'old-master-key-1234';
  const newKey = 'new-master-key-5678';
  const source = [
    `GEMINI_API_KEY=${encryptSecret('gemini-secret', oldKey)}`,
    `FACEBOOK_PAGE_ACCESS_TOKEN=${encryptSecret('page-secret', oldKey)}`,
    `META_APP_SECRET=${encryptSecret('app-secret', oldKey)}`,
    `SHRINEFLOW_MASTER_KEY=${oldKey}`,
  ].join('\n');

  const rotated = rotateEnvironmentContent(source, oldKey, newKey);
  const parsed = parseEnvContent(rotated.content);
  const plain = decryptEnvironmentSecrets(parsed, newKey);

  assert.equal(plain.GEMINI_API_KEY, 'gemini-secret');
  assert.equal(plain.FACEBOOK_PAGE_ACCESS_TOKEN, 'page-secret');
  assert.equal(plain.META_APP_SECRET, 'app-secret');
  assert.equal(parsed.SHRINEFLOW_MASTER_KEY, newKey);
  assert.equal(isEncryptedSecret(parsed.GEMINI_API_KEY), true);
  assert.equal(isEncryptedSecret(parsed.FACEBOOK_PAGE_ACCESS_TOKEN), true);
  assert.throws(() => decryptEnvironmentSecrets(parsed, oldKey), /Token 解密失敗/);
});

test('environment secret rotation rejects an incorrect current key for encrypted values', () => {
  const source = `GEMINI_API_KEY=${encryptSecret('gemini-secret', 'real-master-key')}`;
  assert.throws(
    () => rotateEnvironmentContent(source, 'wrong-master-key', 'new-master-key-5678'),
    /Token 解密失敗/,
  );
});

test('secret rotation route validates the current key and minimum new key length', async () => {
  const previous = process.env.SHRINEFLOW_MASTER_KEY;
  process.env.SHRINEFLOW_MASTER_KEY = 'active-master-key-1234';
  const app = express();
  app.use(express.json());
  app.use('/api', createSettingsRouter({}));
  const server = await new Promise((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });

  try {
    const wrongCurrent = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/rotate-secrets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentMasterKey: 'wrong', newMasterKey: 'new-master-key-5678' }),
    });
    assert.equal(wrongCurrent.status, 400);
    assert.match((await wrongCurrent.json()).error, /Current master key/);

    const shortNew = await fetch(`http://127.0.0.1:${server.address().port}/api/settings/rotate-secrets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentMasterKey: 'active-master-key-1234', newMasterKey: 'short' }),
    });
    assert.equal(shortNew.status, 400);
    assert.match((await shortNew.json()).error, /at least 16/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.SHRINEFLOW_MASTER_KEY;
    else process.env.SHRINEFLOW_MASTER_KEY = previous;
  }
});
