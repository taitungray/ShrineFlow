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
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const result = await fetch(`${baseUrl}/rewrite`, {
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

test('generate route supports no-media content generation without creating upload files', async () => {
  const app = express();
  app.use('/api', createGenerateRouter({
    aiService: {
      configured: true,
      async generatePostCopy(input) {
        assert.equal(input.files.length, 0);
        return { facebook: '無素材母稿', reel: '無素材短影音' };
      },
    },
  }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const form = new FormData();
    form.set('contentTopic', '新產品');
    const response = await fetch(`${baseUrl}/generate`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.mediaPaths, []);
    assert.equal(body.facebook, '無素材母稿');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('generate route binds existing library media from mediaSequence', async () => {
  const app = express();
  app.use('/api', createGenerateRouter({
    aiService: {
      configured: true,
      async generatePostCopy(input) {
        assert.equal(input.files.length, 0);
        return { facebook: '沿用舊圖', reel: '沿用舊圖短影音' };
      },
    },
    repositories: {
      mediaAssets: {
        async list() {
          return [{
            id: 'asset-photo',
            clientId: 'default',
            mediaPath: '/uploads/altar.jpg',
            originalName: 'altar.jpg',
            mimeType: 'image/jpeg',
            status: 'ready',
          }];
        },
      },
    },
  }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const form = new FormData();
    form.set('contentTopic', '沿用舊圖');
    form.set('mediaSequence', JSON.stringify([
      { kind: 'library', mediaPath: '/uploads/altar.jpg', mediaId: 'asset-photo' },
    ]));
    const response = await fetch(`${baseUrl}/generate`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.mediaPaths, ['/uploads/altar.jpg']);
    assert.equal(body.imagePath, '/uploads/altar.jpg');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('generate route returns clear API errors for missing topic and AI failure', async () => {
  const app = express();
  app.use('/api', createGenerateRouter({
    aiService: {
      configured: true,
      async generatePostCopy() {
        const error = new Error('AI provider unavailable');
        error.status = 429;
        throw error;
      },
    },
  }));
  const server = app.listen(0);
  try {
    const missingTopic = new FormData();
    const missingResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
      method: 'POST',
      body: missingTopic,
    });
    assert.equal(missingResponse.status, 400);

    const failingForm = new FormData();
    failingForm.set('contentTopic', 'API 錯誤測試');
    const failingResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
      method: 'POST',
      body: failingForm,
    });
    assert.equal(failingResponse.status, 429);
    const failed = await failingResponse.json();
    assert.match(failed.error, /AI provider/);
    assert.equal(failed.code, '');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
