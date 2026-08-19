import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { createPostsRouter } from '../lib/routes/posts.js';
import { createScheduleRouter } from '../lib/routes/schedule.js';
import { getPublishingPlatforms } from '../lib/platforms.js';
import { directories, jsonFiles, readJson, writeJson } from '../lib/store.js';

function scheduledPost(scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()) {
  return {
    id: 'post-hidden-1',
    clientId: 'brand-a',
    contentTopic: '邢府大千歲',
    facebook: '親手為這尊邢府大千歲進行彩繪。',
    createdAt: '2026-08-16T12:52:00.000Z',
    updatedAt: '2026-08-16T12:52:00.000Z',
    status: 'scheduled',
    targets: [{
      id: 'target-hidden-1',
      accountId: 'facebook:1',
      platformId: 'facebook',
      contentType: 'post',
      status: 'scheduled',
      scheduledAt,
      externalId: 'graph-hidden-1',
    }],
  };
}

test('hide keeps remote schedule intact and drops the row from GET /schedule', async () => {
  const originalPaths = {
    posts: jsonFiles.posts,
    clients: jsonFiles.clients,
    schedule: jsonFiles.schedule,
    postVersions: directories.postVersions,
  };
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'shrineflow-post-hide-'));
  jsonFiles.posts = path.join(temporaryDirectory, 'posts.json');
  jsonFiles.clients = path.join(temporaryDirectory, 'clients.json');
  jsonFiles.schedule = path.join(temporaryDirectory, 'schedule.json');
  directories.postVersions = path.join(temporaryDirectory, 'post-versions');
  await writeJson(jsonFiles.posts, [scheduledPost()]);
  await writeJson(jsonFiles.clients, [{
    id: 'brand-a',
    name: 'Brand A',
    accounts: [{ id: 'facebook:1', platformId: 'facebook' }],
  }]);
  await writeJson(jsonFiles.schedule, []);

  const app = express();
  app.use(express.json());
  app.use('/api', createPostsRouter());
  app.use('/api', createScheduleRouter({ publishingPlatforms: getPublishingPlatforms(true) }));
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const beforeSchedule = await (await fetch(`${baseUrl}/schedule?clientId=brand-a`)).json();
    assert.equal(beforeSchedule.some((item) => item.postId === 'post-hidden-1'), true);

    const hideResponse = await fetch(`${baseUrl}/posts/post-hidden-1/hide`, { method: 'POST' });
    assert.equal(hideResponse.status, 200);
    const hidden = await hideResponse.json();
    assert.ok(hidden.hiddenAt);
    assert.equal(hidden.status, 'scheduled');
    assert.equal(hidden.targets[0].status, 'scheduled');
    assert.ok(hidden.targets[0].scheduledAt);
    assert.equal(hidden.targets[0].externalId, 'graph-hidden-1');
    assert.ok(hidden.lifecycleEvents.some((event) => event.event === 'hidden'));

    const afterSchedule = await (await fetch(`${baseUrl}/schedule?clientId=brand-a`)).json();
    assert.equal(afterSchedule.some((item) => item.postId === 'post-hidden-1'), false);

    const listed = await (await fetch(`${baseUrl}/posts?clientId=brand-a`)).json();
    assert.ok(listed[0].hiddenAt);

    const unhideResponse = await fetch(`${baseUrl}/posts/post-hidden-1/unhide`, { method: 'POST' });
    assert.equal(unhideResponse.status, 200);
    const restored = await unhideResponse.json();
    assert.equal(restored.hiddenAt, null);
    assert.equal(restored.targets[0].externalId, 'graph-hidden-1');

    const visibleAgain = await (await fetch(`${baseUrl}/schedule?clientId=brand-a`)).json();
    assert.equal(visibleAgain.some((item) => item.postId === 'post-hidden-1'), true);

    await fetch(`${baseUrl}/posts/post-hidden-1/hide`, { method: 'POST' });
    const duplicateResponse = await fetch(`${baseUrl}/posts/post-hidden-1/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(duplicateResponse.status, 201);
    const duplicate = await duplicateResponse.json();
    assert.equal(duplicate.hiddenAt, null);
    assert.equal(duplicate.status, 'draft');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(jsonFiles, originalPaths);
    directories.postVersions = originalPaths.postVersions;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
