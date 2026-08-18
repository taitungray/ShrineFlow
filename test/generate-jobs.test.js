import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createBackgroundJobStore } from '../lib/background-jobs.js';
import { createGenerateRouter } from '../lib/routes/generate.js';

test('generate keeps the start request open until Gemini finishes', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let generateStarted = false;
  const jobStore = createBackgroundJobStore();
  const app = express();
  app.use('/api', createGenerateRouter({
    jobStore,
    aiService: {
      configured: true,
      async generatePostCopy(input) {
        assert.equal(input.files.length, 0);
        generateStarted = true;
        await gate;
        return { facebook: '背景完成', reel: '背景完成短影音' };
      },
    },
  }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const form = new FormData();
    form.set('contentTopic', '新產品');
    const pending = fetch(`${baseUrl}/generate`, { method: 'POST', body: form });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(generateStarted, true);
    const raced = await Promise.race([
      pending.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 20)),
    ]);
    assert.equal(raced, 'waiting');

    release();
    const started = await pending;
    assert.equal(started.status, 200);
    const body = await started.json();
    assert.equal(body.facebook, '背景完成');
    assert.equal(body.jobId, undefined);
    assert.deepEqual(body.mediaPaths, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rewrite keeps the start request open until the copy is ready', async () => {
  const jobStore = createBackgroundJobStore();
  const app = express();
  app.use(express.json());
  app.use('/api', createGenerateRouter({
    jobStore,
    aiService: {
      configured: true,
      async rewritePlatformCopy() {
        return { platformId: 'threads', contentType: 'post', copy: '改寫完成', source: 'ai_rewrite' };
      },
    },
  }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const started = await fetch(`${baseUrl}/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformId: 'threads', contentType: 'post', sourceCopy: '母稿內容' }),
    });
    assert.equal(started.status, 200);
    const body = await started.json();
    assert.equal(body.copy, '改寫完成');
    assert.equal(body.jobId, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
