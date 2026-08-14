import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquireJsonLock,
  mutateJson,
  readJson,
  STORAGE_POLICY,
  writeJson,
} from '../lib/store.js';

test('JSON storage serializes mutations and keeps one recovery backup', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-store-'));
  const filePath = path.join(temporaryDirectory, 'state.json');

  await writeJson(filePath, { counter: 0, items: [] });
  await Promise.all(Array.from({ length: 20 }, (_, index) => mutateJson(filePath, (state) => {
    state.counter += 1;
    state.items.push(index);
  }, { counter: 0, items: [] })));

  const saved = await readJson(filePath, {});
  assert.equal(saved.counter, 20);
  assert.equal(saved.items.length, 20);

  await writeJson(filePath, { counter: 21, items: saved.items });
  const recoveryBackup = await readJson(`${filePath}.bak`, {});
  assert.equal(recoveryBackup.counter, 20);

  await fs.writeFile(filePath, '{ invalid json', 'utf8');
  assert.equal((await readJson(filePath, {})).counter, 20);
  await writeJson(filePath, { counter: 22, items: saved.items });
  assert.equal((await readJson(`${filePath}.bak`, {})).counter, 20);

  const names = await fs.readdir(temporaryDirectory);
  assert.equal(names.filter((name) => name.endsWith('.lock')).length, 0);
  assert.equal(names.filter((name) => name.endsWith('.tmp')).length, 0);
  assert.equal(names.filter((name) => name.endsWith('.bak')).length, STORAGE_POLICY.recoveryBackupCount);
});

test('JSON storage reclaims an expired lock without accumulating lock files', async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-lock-'));
  const filePath = path.join(temporaryDirectory, 'state.json');
  const lockPath = `${filePath}.lock`;

  await fs.writeFile(lockPath, JSON.stringify({ expiresAt: Date.now() - 1 }), 'utf8');
  const release = await acquireJsonLock(filePath, { timeoutMs: 100, leaseMs: 1_000 });

  await assert.rejects(
    () => acquireJsonLock(filePath, { timeoutMs: 60, leaseMs: 5_000 }),
    (error) => error.code === 'STORAGE_LOCK_TIMEOUT',
  );
  await release();
  await fs.rm(lockPath, { force: true });
});
