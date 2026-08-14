import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

import { createWebhookRouter, verifyMetaWebhookSignature } from '../lib/routes/webhooks.js';

function signature(rawBody, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

test('Meta webhook signature requires the raw body and app secret', () => {
  const rawBody = Buffer.from('{"object":"page","entry":[]}');
  assert.equal(verifyMetaWebhookSignature(rawBody, signature(rawBody, 'app-secret'), 'app-secret'), true);
  assert.equal(verifyMetaWebhookSignature(rawBody, signature(Buffer.from('{}'), 'app-secret'), 'app-secret'), false);
  assert.equal(verifyMetaWebhookSignature(rawBody, '', 'app-secret'), false);
});

test('Meta webhook verification endpoint returns challenge only with configured token', async () => {
  const app = express();
  app.use('/api', createWebhookRouter({ appSecret: 'app-secret', verifyToken: 'verify-token' }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-1`);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), 'challenge-1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Meta webhook POST acknowledges valid signed event without storing payload', async () => {
  const app = express();
  app.use(express.json({ verify: (request, _response, buffer) => { request.rawBody = Buffer.from(buffer); } }));
  app.use('/api', createWebhookRouter({ appSecret: 'app-secret', verifyToken: 'verify-token' }));
  const server = app.listen(0);
  try {
    const rawBody = Buffer.from(JSON.stringify({ object: 'page', entry: [{ messaging: [{ message: 'private' }] }] }));
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/meta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature(rawBody, 'app-secret'),
      },
      body: rawBody,
    });
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.received, true);
    assert.equal(payload.stored, false);
    assert.equal(JSON.stringify(payload).includes('private'), false);

    const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=invalid' },
      body: rawBody,
    });
    assert.equal(invalid.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
