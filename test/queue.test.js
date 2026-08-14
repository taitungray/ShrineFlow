import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { nextQueueSequence, nextQueueSlot, normalizeQueue } from '../lib/queue.js';
import { createQueuesRouter } from '../lib/routes/queues.js';
import { createScheduleRouter } from '../lib/routes/schedule.js';
import { getPublishingPlatforms } from '../lib/platforms.js';

function clientsRepository(initial = []) {
  let records = initial.map((record) => structuredClone(record));
  return {
    async list() { return structuredClone(records); },
    async mutate(mutator) {
      const result = await mutator(records);
      return result;
    },
  };
}

test('normalizes queue settings and rejects invalid slots', () => {
  const queue = normalizeQueue({
    enabled: true,
    timeZone: 'Asia/Taipei',
    slots: [{ weekday: 1, localTime: '09:30' }],
  }, { accountId: 'facebook:1' });
  assert.equal(queue.id, 'queue-facebook:1');
  assert.equal(queue.slots[0].id, 'slot-1-0930');
  assert.throws(() => normalizeQueue({ enabled: true, slots: [] }), /至少需要一個有效時段/);
  assert.throws(() => normalizeQueue({ slots: [{ weekday: 1, localTime: '09:30' }, { weekday: 1, localTime: '09:30' }] }), /重複/);
  assert.throws(() => normalizeQueue({ timeZone: 'Not/AZone' }), /IANA/);
});

test('finds the next slot, skips occupied slots, and increments sequence', () => {
  const queue = normalizeQueue({
    id: 'queue-1',
    enabled: true,
    timeZone: 'Asia/Taipei',
    slots: [
      { id: 'morning', weekday: 1, localTime: '09:00' },
      { id: 'late-morning', weekday: 1, localTime: '10:00' },
    ],
  });
  const fromDate = new Date('2026-08-16T16:00:00.000Z');
  const first = nextQueueSlot({ queue, fromDate });
  assert.equal(first.scheduledLocal, '2026-08-17T09:00');
  assert.equal(first.scheduledAt, '2026-08-17T01:00:00.000Z');
  const second = nextQueueSlot({
    queue,
    fromDate,
    existingSchedules: [{ status: 'scheduled', scheduledAt: first.scheduledAt, queueSequence: 4 }],
  });
  assert.equal(second.scheduledLocal, '2026-08-17T10:00');
  assert.equal(nextQueueSequence([{ queueSequence: 4 }, { queueSequence: 2 }]), 5);
});

test('queue settings API stores an account-scoped queue', async () => {
  const repositories = {
    clients: clientsRepository([{
      id: 'client-1',
      accounts: [{ id: 'instagram:1', platformId: 'instagram', name: 'IG', configured: true }],
    }]),
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createQueuesRouter({ repositories }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/queues`;
    const saved = await fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-1',
        accountId: 'instagram:1',
        enabled: true,
        timeZone: 'Asia/Taipei',
        slots: [{ weekday: 2, localTime: '18:30' }],
      }),
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.queue.slots[0].localTime, '18:30');

    const loaded = await fetch(`${base}?clientId=client-1&accountId=instagram:1`);
    assert.equal(loaded.status, 200);
    assert.equal((await loaded.json()).queue.enabled, true);
    assert.equal((await repositories.clients.list())[0].accounts[0].queue.slots[0].weekday, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /schedule assigns the next account queue slot without a manual time', async () => {
  const repositories = {
    clients: clientsRepository([{
      id: 'client-queue',
      accounts: [{
        id: 'instagram:queue',
        platformId: 'instagram',
        configured: true,
        queue: {
          id: 'queue-instagram',
          enabled: true,
          timeZone: 'Asia/Taipei',
          slots: [{ id: 'monday-morning', weekday: 1, localTime: '09:00' }],
        },
      }],
    }]),
    posts: clientsRepository([{
      id: 'queue-post',
      clientId: 'client-queue',
      facebook: 'Queue post',
      mediaPaths: ['/uploads/queue.jpg'],
      targets: [{
        id: 'queue-target',
        accountId: 'instagram:queue',
        platformId: 'instagram',
        contentType: 'feed',
        status: 'draft',
      }],
    }]),
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createScheduleRouter({
    publishingPlatforms: getPublishingPlatforms(true),
    repositories,
    resolveFacebookPublisher: async () => { throw new Error('不應呼叫 Facebook'); },
  }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: 'queue-post',
        targetId: 'queue-target',
        accountId: 'instagram:queue',
        channel: 'instagram',
        contentType: 'feed',
        scheduleMode: 'queue',
      }),
    });
    assert.equal(response.status, 201);
    const item = await response.json();
    assert.equal(item.scheduleMode, 'queue');
    assert.equal(item.queueSlotId, 'monday-morning');
    assert.ok(new Date(item.scheduledAt).getTime() > Date.now());
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
