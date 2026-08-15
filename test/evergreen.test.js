import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { createEvergreenRouter } from '../lib/routes/evergreen.js';
import { scheduleNextEvergreenOccurrence } from '../lib/evergreen.js';
import { directories } from '../lib/store.js';
import { normalizeTarget } from '../lib/post-targets.js';

function sourcePost() {
  return {
    id: 'post-root',
    clientId: 'client-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    version: 1,
    status: 'published',
    approvalState: 'approved',
    contentTopic: '常青內容',
    godName: '常青內容',
    facebook: '固定內容文案',
    reel: '',
    channel: 'instagram',
    contentType: 'feed',
    mediaPaths: ['/uploads/evergreen.jpg'],
    targets: [normalizeTarget({
      id: 'target-root',
      accountId: 'instagram:1',
      platformId: 'instagram',
      contentType: 'feed',
      mediaPaths: ['/uploads/evergreen.jpg'],
      status: 'published',
      publishedAt: '2026-08-15T00:00:00.000Z',
      externalId: 'remote-root',
    })],
  };
}

test('evergreen creates bounded, deduplicated local occurrences', async () => {
  const versionDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-evergreen-'));
  const originalVersionDirectory = directories.postVersions;
  directories.postVersions = versionDirectory;
  const records = [sourcePost()];
  records[0].evergreen = {
    enabled: true,
    paused: false,
    intervalDays: 7,
    maxOccurrences: 2,
    occurrenceCount: 0,
    nextScheduledAt: '2026-08-22T00:00:00.000Z',
  };
  const repositories = {
    posts: {
      async list() { return records; },
      async mutate(mutator) { return mutator(records); },
    },
  };
  try {
    const first = await scheduleNextEvergreenOccurrence({
      sourcePostId: 'post-root',
      sourceTargetId: 'target-root',
      nextAt: '2026-08-22T00:00:00.000Z',
      now: new Date('2026-08-15T00:00:00.000Z'),
      repositories,
    });
    assert.equal(first.status, 'scheduled');
    assert.equal(records.length, 2);
    assert.equal(records[0].evergreen.occurrenceCount, 1);
    assert.equal(records[1].evergreenSource.sequence, 1);
    assert.equal(records[1].targets[0].status, 'scheduled');
    assert.equal(records[1].targets[0].scheduleSource, 'local');

    const second = await scheduleNextEvergreenOccurrence({
      sourcePostId: 'post-root',
      sourceTargetId: 'target-root',
      nextAt: '2026-08-29T00:00:00.000Z',
      now: new Date('2026-08-22T00:00:00.000Z'),
      repositories,
    });
    assert.equal(second.status, 'scheduled');
    assert.equal(records.length, 3);
    assert.equal(records[0].evergreen.occurrenceCount, 2);

    const limited = await scheduleNextEvergreenOccurrence({
      sourcePostId: 'post-root',
      sourceTargetId: 'target-root',
      now: new Date('2026-08-29T00:00:00.000Z'),
      repositories,
    });
    assert.equal(limited.status, 'limit_reached');
    assert.equal(records.length, 3);

    records[0].evergreen.paused = true;
    const paused = await scheduleNextEvergreenOccurrence({
      sourcePostId: 'post-root',
      sourceTargetId: 'target-root',
      repositories,
    });
    assert.equal(paused.status, 'paused');
  } finally {
    directories.postVersions = originalVersionDirectory;
    await fs.rm(versionDirectory, { recursive: true, force: true });
  }
});

test('evergreen route enables local recurrence and supports pause without remote scheduling', async () => {
  const versionDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-evergreen-route-'));
  const originalVersionDirectory = directories.postVersions;
  directories.postVersions = versionDirectory;
  const records = [sourcePost()];
  const repositories = {
    posts: {
      async list() { return records; },
      async mutate(mutator) { return mutator(records); },
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createEvergreenRouter({
    repositories,
    listClients: async () => [{ id: 'client-1', name: 'Brand A', approvalRequired: false }],
  }));
  const server = app.listen(0);
  try {
    const enabled = await fetch(`http://127.0.0.1:${server.address().port}/api/posts/post-root/evergreen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', intervalDays: 7, maxOccurrences: 1, startAt: '2026-08-22T00:00:00.000Z' }),
    });
    assert.equal(enabled.status, 201);
    const enabledPayload = await enabled.json();
    assert.equal(enabledPayload.scheduleMode, 'local');
    assert.equal(enabledPayload.remoteScheduling, false);
    assert.equal(records.length, 2);
    assert.equal(records[0].evergreen.enabled, true);

    const paused = await fetch(`http://127.0.0.1:${server.address().port}/api/posts/post-root/evergreen`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', paused: true }),
    });
    assert.equal(paused.status, 200);
    const pausedPayload = await paused.json();
    assert.equal(pausedPayload.evergreen.paused, true);
    assert.ok(records[0].lifecycleEvents.some((event) => event.event === 'evergreen_paused'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    directories.postVersions = originalVersionDirectory;
    await fs.rm(versionDirectory, { recursive: true, force: true });
  }
});
