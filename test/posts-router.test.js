import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { createPostsRouter } from '../lib/routes/posts.js';
import { directories, jsonFiles, readJson, writeJson } from '../lib/store.js';

test('posts router saves and validates multiple platform targets independently', async () => {
  const originalPaths = { posts: jsonFiles.posts, clients: jsonFiles.clients, postVersions: directories.postVersions };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-posts-router-'));
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
        contentTopic: '新品上市',
        facebook: 'Facebook 母稿',
        reel: 'Reel 母稿',
        targets: [
          {
            id: 'target-facebook',
            platformId: 'facebook',
            contentType: 'post',
            mediaPaths: ['/uploads/facebook.jpg'],
          },
          {
            id: 'target-instagram',
            platformId: 'instagram',
            contentType: 'feed',
            copyOverride: 'Instagram 覆寫',
            mediaPaths: ['/uploads/instagram.jpg'],
          },
          {
            id: 'target-threads',
            platformId: 'threads',
            contentType: 'post',
            copyOverride: 'Threads 版本',
          },
        ],
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.clientId, 'brand-a');
    assert.equal(created.version, 1);
    assert.equal(created.targets.length, 3);
    assert.equal(created.validation.valid, true);
    assert.equal(created.targets.find((target) => target.platformId === 'instagram').copyOverride, 'Instagram 覆寫');

    const validateResponse = await fetch(`${baseUrl}/posts/${created.id}/validate`, { method: 'POST' });
    assert.equal(validateResponse.status, 200);
    const validation = await validateResponse.json();
    assert.equal(validation.valid, true);
    assert.equal(validation.targets.length, 3);

    const patchResponse = await fetch(`${baseUrl}/posts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targets: created.targets.map((target) => target.platformId === 'threads'
          ? { ...target, copyOverride: 'Threads 更新版本' }
          : target),
      }),
    });
    assert.equal(patchResponse.status, 200);
    const patched = await patchResponse.json();
    assert.equal(patched.targets.find((target) => target.platformId === 'threads').copyOverride, 'Threads 更新版本');
    assert.equal(patched.version, 2);

    const staleResponse = await fetch(`${baseUrl}/posts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: 1, extraNotes: 'stale write' }),
    });
    assert.equal(staleResponse.status, 409);
    const staleBody = await staleResponse.json();
    assert.equal(staleBody.code, 'POST_VERSION_CONFLICT');
    assert.equal(staleBody.currentVersion, 2);

    const versionsResponse = await fetch(`${baseUrl}/posts/${created.id}/versions`);
    assert.equal(versionsResponse.status, 200);
    const versionsBody = await versionsResponse.json();
    assert.equal(versionsBody.currentVersion, 2);
    assert.equal(versionsBody.versions.length, 2);
    assert.equal(versionsBody.versions[0].source, 'manual');
    assert.equal(versionsBody.versions[1].source, 'created');

    const restoreResponse = await fetch(`${baseUrl}/posts/${created.id}/versions/${versionsBody.versions[1].versionId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: 2 }),
    });
    assert.equal(restoreResponse.status, 200);
    const restored = await restoreResponse.json();
    assert.equal(restored.version, 3);
    assert.equal(restored.status, 'draft');
    assert.equal(restored.targets.length, 3);
    assert.ok(restored.targets.every((target) => target.status === 'draft'));
    assert.notEqual(restored.targets[0].id, created.targets[0].id);

    const archiveResponse = await fetch(`${baseUrl}/posts/${created.id}/archive`, { method: 'POST' });
    assert.equal(archiveResponse.status, 200);
    const archived = await archiveResponse.json();
    assert.equal(archived.status, 'archived');
    assert.equal(archived.version, 4);
    assert.ok(archived.lifecycleEvents.some((event) => event.event === 'archived'));

    const archivedListResponse = await fetch(`${baseUrl}/posts?clientId=brand-a`);
    const archivedList = await archivedListResponse.json();
    assert.equal(archivedList[0].status, 'archived');

    const restoreLifecycleResponse = await fetch(`${baseUrl}/posts/${created.id}/restore`, { method: 'POST' });
    assert.equal(restoreLifecycleResponse.status, 200);
    const restoredLifecycle = await restoreLifecycleResponse.json();
    assert.equal(restoredLifecycle.status, 'draft');
    assert.equal(restoredLifecycle.version, 5);

    const duplicateResponse = await fetch(`${baseUrl}/posts/${created.id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(duplicateResponse.status, 201);
    const duplicate = await duplicateResponse.json();
    assert.notEqual(duplicate.id, created.id);
    assert.equal(duplicate.version, 1);
    assert.equal(duplicate.status, 'draft');
    assert.ok(duplicate.targets.every((target) => target.status === 'draft'));
    assert.notEqual(duplicate.targets[0].id, restoredLifecycle.targets[0].id);
    assert.equal(duplicate.duplicatedFrom, created.id);
    const saved = await readJson(jsonFiles.posts, []);
    assert.equal(saved.length, 2);
    assert.equal(saved[0].targets.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(jsonFiles, originalPaths);
    directories.postVersions = originalPaths.postVersions;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('posts router rejects an oversized multi-platform media selection before persistence', async () => {
  const originalPaths = { posts: jsonFiles.posts, clients: jsonFiles.clients, postVersions: directories.postVersions };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-posts-invalid-'));
  jsonFiles.posts = path.join(temporaryDirectory, 'posts.json');
  jsonFiles.clients = path.join(temporaryDirectory, 'clients.json');
  directories.postVersions = path.join(temporaryDirectory, 'post-versions');
  await writeJson(jsonFiles.posts, []);
  await writeJson(jsonFiles.clients, [{ id: 'brand-a', name: 'Brand A', accounts: [] }]);

  const app = express();
  app.use(express.json());
  app.use('/api', createPostsRouter());
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'brand-a',
        contentTopic: '多圖測試',
        facebook: '母稿',
        targets: [{
          id: 'target-instagram',
          platformId: 'instagram',
          contentType: 'feed',
          mediaPaths: Array.from({ length: 11 }, (_item, index) => `/uploads/${index}.jpg`),
        }],
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.validation.errors.some((issue) => issue.code === 'media_count_exceeded'));
    assert.deepEqual(await readJson(jsonFiles.posts, []), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(jsonFiles, originalPaths);
    directories.postVersions = originalPaths.postVersions;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
