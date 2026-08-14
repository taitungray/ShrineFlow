import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createRemoteScheduleRouter } from '../lib/routes/remote-schedule.js';

test('remote schedule stays explicitly unavailable when the connector capability is not verified', async (t) => {
  let publisherCalls = 0;
  const app = express();
  app.use('/api', createRemoteScheduleRouter({
    getClient: async () => ({
      id: 'client-1',
      accounts: [{
        id: 'facebook-1',
        platformId: 'facebook',
        capabilities: { remote_schedule_read: { status: 'not_available', reason: 'api_spike_required' } },
      }],
    }),
    resolveFacebookPublisher: async () => {
      publisherCalls += 1;
      return { listScheduledPosts: async () => ({ data: [{ id: 'should-not-be-read' }] }) };
    },
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/remote-schedule?clientId=client-1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'remote_schedule_unavailable');
  assert.equal(body.sources[0].status, 'remote_schedule_unavailable');
  assert.equal(body.sources[0].capability.reason, 'api_spike_required');
  assert.deepEqual(body.sources[0].data, []);
  assert.equal(publisherCalls, 0);
});

test('remote schedule does not claim support when a verified capability lacks a connector method', async (t) => {
  const app = express();
  app.use('/api', createRemoteScheduleRouter({
    getClient: async () => ({
      id: 'client-1',
      accounts: [{ id: 'facebook-1', platformId: 'facebook', capabilities: { remote_schedule_read: { status: 'supported' } } }],
    }),
    resolveFacebookPublisher: async () => ({ configured: true }),
  }));
  const server = app.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/remote-schedule?clientId=client-1`);
  const body = await response.json();
  assert.equal(body.status, 'remote_schedule_unavailable');
  assert.equal(body.sources[0].capability.reason, 'connector_not_implemented');
});
