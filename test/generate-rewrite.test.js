import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createGenerateRouter } from '../lib/routes/generate.js';

test('platform rewrite route returns an AI suggestion without persisting message content', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createGenerateRouter({
    aiService: {
      configured: true,
      async rewritePlatformCopy(input) {
        assert.equal(input.platformId, 'threads');
        assert.equal(input.contentType, 'post');
        assert.equal(input.sourceCopy, '母稿內容');
        return { platformId: 'threads', contentType: 'post', copy: '改寫後內容', source: 'ai_rewrite' };
      },
    },
  }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformId: 'threads', contentType: 'post', sourceCopy: '母稿內容' }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      platformId: 'threads',
      contentType: 'post',
      copy: '改寫後內容',
      source: 'ai_rewrite',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('platform rewrite route rejects unsupported platforms and empty source copy', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createGenerateRouter({ aiService: { configured: true } }));
  const server = app.listen(0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformId: 'unknown', sourceCopy: '' }),
    });
    assert.equal(result.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
