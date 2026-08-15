import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { createPostsRouter } from '../lib/routes/posts.js';
import { isPostIdea, normalizeContentStage } from '../lib/post-lifecycle.js';
import { directories, jsonFiles, readJson, writeJson } from '../lib/store.js';

test('content stage keeps Ideas outside the draft validation path until promoted', async () => {
  assert.equal(normalizeContentStage('idea'), 'idea');
  assert.equal(normalizeContentStage('unknown'), 'draft');
  assert.equal(isPostIdea({ contentStage: 'idea' }), true);
  assert.equal(isPostIdea({ contentStage: 'draft' }), false);

  const originalPaths = { posts: jsonFiles.posts, clients: jsonFiles.clients, postVersions: directories.postVersions };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-content-stage-'));
  jsonFiles.posts = path.join(temporaryDirectory, 'posts.json');
  jsonFiles.clients = path.join(temporaryDirectory, 'clients.json');
  directories.postVersions = path.join(temporaryDirectory, 'post-versions');
  await writeJson(jsonFiles.posts, []);
  await writeJson(jsonFiles.clients, [{ id: 'brand-a', name: 'Brand A', accounts: [] }]);

  const app = express();
  app.use(express.json());
  app.use('/api', createPostsRouter());
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const createResponse = await fetch(`${baseUrl}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'brand-a',
        contentTopic: '中元普渡前的供桌整理提醒',
        contentStage: 'idea',
        extraNotes: '等待拍攝供桌整理前後對照圖',
      }),
    });
    assert.equal(createResponse.status, 201);
    const idea = await createResponse.json();
    assert.equal(idea.contentStage, 'idea');
    assert.equal(idea.facebook, '');
    assert.equal(idea.validation.valid, true);

    const promoteResponse = await fetch(`${baseUrl}/posts/${idea.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentStage: 'draft',
        facebook: '整理供桌前，先把動線與供品位置安排好。',
        baseVersion: idea.version,
      }),
    });
    assert.equal(promoteResponse.status, 200);
    const promoted = await promoteResponse.json();
    assert.equal(promoted.contentStage, 'draft');
    assert.equal(promoted.version, 2);
    assert.equal(promoted.validation.valid, true);

    const publishedRecords = await readJson(jsonFiles.posts, []);
    publishedRecords[0].status = 'published';
    publishedRecords[0].targets[0] = {
      ...publishedRecords[0].targets[0],
      status: 'published',
      externalId: 'facebook-post-1',
      publishedAt: '2026-08-14T00:00:00.000Z',
    };
    await writeJson(jsonFiles.posts, publishedRecords);
    const repurposeResponse = await fetch(`${baseUrl}/posts/${idea.id}/repurpose`, { method: 'POST' });
    assert.equal(repurposeResponse.status, 201);
    const repurposed = await repurposeResponse.json();
    assert.equal(repurposed.lifecycleAction, 'repurposed');
    assert.equal(repurposed.sourcePostId, idea.id);
    assert.equal(repurposed.contentStage, 'draft');
    assert.equal(repurposed.status, 'draft');

    const versions = await fetch(`${baseUrl}/posts/${idea.id}/versions`).then((response) => response.json());
    assert.equal(versions.versions[0].content.contentStage, 'draft');
    assert.equal(versions.versions[1].content.contentStage, 'idea');
    assert.equal((await readJson(jsonFiles.posts, []))[0].contentStage, 'draft');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(jsonFiles, originalPaths);
    directories.postVersions = originalPaths.postVersions;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
