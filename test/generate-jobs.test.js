import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createBackgroundJobStore } from '../lib/background-jobs.js';
import { createGenerateRouter } from '../lib/routes/generate.js';

async function waitForJob(baseUrl, jobId, { timeoutMs = 1_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${baseUrl}/generate/jobs/${jobId}`);
    const body = await response.json();
    if (body.status === 'succeeded' || body.status === 'failed') return { response, body };
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('timed out waiting for generate job');
}

test('generate starts a background job that stays recoverable after the start request ends', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const jobStore = createBackgroundJobStore();
  const app = express();
  app.use('/api', createGenerateRouter({
    jobStore,
    aiService: {
      configured: true,
      async generatePostCopy(input) {
        assert.equal(input.files.length, 0);
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
    const started = await fetch(`${baseUrl}/generate`, { method: 'POST', body: form });
    assert.equal(started.status, 202);
    const startBody = await started.json();
    assert.ok(startBody.jobId);
    assert.equal(startBody.status, 'queued');

    const pending = await fetch(`${baseUrl}/generate/jobs/${startBody.jobId}`);
    assert.equal(pending.status, 200);
    const pendingBody = await pending.json();
    assert.ok(['queued', 'running'].includes(pendingBody.status));
    assert.equal(pendingBody.result, null);

    release();
    const finished = await waitForJob(baseUrl, startBody.jobId);
    assert.equal(finished.body.status, 'succeeded');
    assert.equal(finished.body.result.facebook, '背景完成');
    assert.deepEqual(finished.body.result.mediaPaths, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rewrite starts a background job and exposes the rewritten copy on the job', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const jobStore = createBackgroundJobStore();
  const app = express();
  app.use(express.json());
  app.use('/api', createGenerateRouter({
    jobStore,
    aiService: {
      configured: true,
      async rewritePlatformCopy() {
        await gate;
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
    assert.equal(started.status, 202);
    const { jobId } = await started.json();
    release();
    const finished = await waitForJob(baseUrl, jobId);
    assert.equal(finished.body.result.copy, '改寫完成');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
