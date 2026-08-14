import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyInboxItemMetadata,
  clearInboxSyncHint,
  getInboxCursor,
  getInboxSyncHint,
  inboxItemKey,
  INBOX_METADATA_POLICY,
  markInboxSyncHint,
  saveInboxCursor,
  updateInboxItemMetadata,
} from '../lib/inbox-metadata.js';
import { jsonFiles, readJson, writeJson } from '../lib/store.js';

test('inbox metadata persists unread, tags, notes and one cursor without message bodies', async () => {
  const originalPath = jsonFiles.inboxMetadata;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-inbox-meta-'));
  jsonFiles.inboxMetadata = path.join(temporaryDirectory, 'inbox-metadata.json');
  try {
    const identity = { clientId: 'client-1', accountId: 'threads:1', platformId: 'threads', itemId: 'reply-1' };
    await updateInboxItemMetadata(identity, {
      unread: false,
      tags: '客戶, 待回覆, 客戶',
      note: '只保存工作備註。',
    });
    const items = await applyInboxItemMetadata([{ id: 'reply-1', text: 'provider body' }], identity);
    assert.equal(items[0].unread, false);
    assert.deepEqual(items[0].tags, ['客戶', '待回覆']);
    assert.equal(items[0].note, '只保存工作備註。');

    await saveInboxCursor(identity, 'opaque-next-cursor');
    assert.equal((await getInboxCursor(identity)).value, 'opaque-next-cursor');
    const syncHint = await markInboxSyncHint(identity, {
      eventType: 'messages',
      eventCount: 2,
      receivedAt: '2026-08-14T00:00:00.000Z',
    });
    assert.equal(syncHint.pending, true);
    assert.equal(syncHint.eventCount, 2);
    assert.equal(await getInboxCursor(identity), null);
    assert.equal((await getInboxSyncHint(identity)).eventType, 'messages');
    await clearInboxSyncHint(identity);
    assert.equal(await getInboxSyncHint(identity), null);
    await saveInboxCursor(identity, '');
    assert.equal(await getInboxCursor(identity), null);
    const raw = await readJson(jsonFiles.inboxMetadata, {});
    assert.equal(JSON.stringify(raw).includes('provider body'), false);
  } finally {
    jsonFiles.inboxMetadata = originalPath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('inbox metadata prunes old ephemeral state but keeps user notes', async () => {
  const originalPath = jsonFiles.inboxMetadata;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-inbox-meta-cap-'));
  jsonFiles.inboxMetadata = path.join(temporaryDirectory, 'inbox-metadata.json');
  try {
    const items = {};
    for (let index = 0; index < INBOX_METADATA_POLICY.maxEphemeralItems; index += 1) {
      items[inboxItemKey({ clientId: 'client', accountId: 'account', platformId: 'threads', itemId: 'item-' + index })] = {
        unread: false,
        tags: [],
        note: '',
        updatedAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      };
    }
    items[inboxItemKey({ clientId: 'client', accountId: 'account', platformId: 'threads', itemId: 'protected' })] = {
      unread: false,
      tags: ['重要'],
      note: '保留這筆備註',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await writeJson(jsonFiles.inboxMetadata, { version: 1, items, cursors: {} });
    await updateInboxItemMetadata({
      clientId: 'client',
      accountId: 'account',
      platformId: 'threads',
      itemId: 'new-item',
    }, { unread: true });
    const raw = await readJson(jsonFiles.inboxMetadata, {});
    assert.equal(raw.items[inboxItemKey({ clientId: 'client', accountId: 'account', platformId: 'threads', itemId: 'protected' })].note, '保留這筆備註');
    assert.equal(Object.keys(raw.items).length, INBOX_METADATA_POLICY.maxEphemeralItems);
  } finally {
    jsonFiles.inboxMetadata = originalPath;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
