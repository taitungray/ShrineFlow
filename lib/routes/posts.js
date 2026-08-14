import { Router } from 'express';
import { readJson, mutateJson, makeId, jsonFiles, directories } from '../store.js';
import { formatCopy, normalizePostCopy } from '../copy-format.js';
import {
  migrateLegacyPost,
  normalizeMediaPaths,
  normalizeTarget,
  summarizePostStatus,
} from '../post-targets.js';
import { listClientsRaw } from '../clients.js';
import { validatePostFormat } from '../content-validation.js';
import { assertCollectionCapacity } from '../storage-policy.js';
import { currentPostVersion, bumpPostVersion } from '../post-version.js';
import { appendPostVersion, activePostVersions, getPostVersion, listPostVersions } from '../post-history.js';

async function defaultClientId() {
  const clients = await listClientsRaw();
  return clients[0]?.id || '';
}

function buildTargetsFromBody(body = {}, fallbackClientId = '') {
  if (Array.isArray(body.targets) && body.targets.length > 0) {
    return body.targets.map((target) => normalizeTarget(target));
  }

  const legacy = migrateLegacyPost({
    channel: body.channel || 'facebook',
    accountId: body.accountId || '',
    contentType: body.contentType || 'post',
    contentSettings: body.contentSettings,
    status: 'draft',
  }, fallbackClientId);

  return legacy.targets;
}

function presentPost(post, fallbackClientId = '') {
  const migrated = migrateLegacyPost(post, post.clientId || fallbackClientId);
  const normalized = normalizePostCopy(migrated);
  return {
    ...normalized,
    contentTopic: normalized.contentTopic || normalized.godName || '',
  };
}

export function createPostsRouter() {
  const router = Router();

  router.get('/posts', async (request, response) => {
    const clientId = String(request.query.clientId || '').trim();
    const fallbackClientId = await defaultClientId();
    const posts = await readJson(jsonFiles.posts, []);
    const presented = posts
      .map((post) => presentPost(post, fallbackClientId))
      .filter((post) => !clientId || post.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    response.json(presented);
  });

  router.post('/posts', async (request, response) => {
    const body = request.body || {};
    const contentTopic = String(body.contentTopic || body.godName || '').trim();
    if (!contentTopic || !body.facebook || !body.facebook.trim()) {
      return response.status(400).json({ error: '請填寫主題與 Facebook 文案。' });
    }

    const fallbackClientId = await defaultClientId();
    const clientId = String(body.clientId || fallbackClientId || '').trim();
    if (!clientId) {
      return response.status(400).json({ error: '請先建立至少一個品牌。' });
    }

    const targets = buildTargetsFromBody(body, clientId);
    const now = new Date().toISOString();
    const post = {
      id: makeId(),
      createdAt: now,
      updatedAt: now,
      version: 1,
      clientId,
      status: summarizePostStatus(targets),
      contentTopic,
      godName: contentTopic,
      postType: body.postType || 'intro',
      extraNotes: body.extraNotes || '',
      channel: body.channel || targets[0]?.platformId || 'facebook',
      accountId: body.accountId || targets[0]?.accountId || '',
      contentType: body.contentType || targets[0]?.contentType || 'post',
      contentSettings: body.contentSettings && typeof body.contentSettings === 'object'
        ? body.contentSettings
        : (targets[0]?.contentSettings || {}),
      imagePath: body.imagePath || '',
      mediaPaths: Array.isArray(body.mediaPaths) && body.mediaPaths.length
        ? normalizeMediaPaths(body.mediaPaths)
        : (body.imagePath ? [body.imagePath] : []),
      facebook: formatCopy(body.facebook, 'facebook'),
      reel: formatCopy(body.reel, 'reel'),
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
      imageDescription: body.imageDescription || '',
      targets,
    };

    const validation = await validatePostFormat(post, { uploadsDirectory: directories.uploads });
    if (!validation.valid) {
      return response.status(400).json({ error: validation.errors[0].message, validation });
    }

    await mutateJson(jsonFiles.posts, (posts) => {
      assertCollectionCapacity('posts', posts.length, 1);
      posts.push(post);
    });
    await appendPostVersion({ post, source: 'created' });
    response.status(201).json({ ...presentPost(post, clientId), validation });
  });

  router.patch('/posts/:postId', async (request, response) => {
    const updates = { ...(request.body || {}) };
    const versionSource = ['manual', 'autosave', 'schedule', 'publish', 'restore'].includes(String(updates.versionSource))
      ? String(updates.versionSource)
      : 'manual';
    delete updates.versionSource;
    const expectedVersionValue = Object.prototype.hasOwnProperty.call(updates, 'baseVersion')
      ? updates.baseVersion
      : updates.clientRevision;
    delete updates.baseVersion;
    delete updates.clientRevision;
    const expectedVersion = expectedVersionValue === undefined || expectedVersionValue === null || expectedVersionValue === ''
      ? null
      : Number(expectedVersionValue);
    if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      return response.status(400).json({
        error: '貼文版本格式不正確。',
        code: 'POST_VERSION_INVALID',
      });
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'facebook')) {
      updates.facebook = formatCopy(updates.facebook, 'facebook');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'reel')) {
      updates.reel = formatCopy(updates.reel, 'reel');
    }

    const fallbackClientId = await defaultClientId();
    const updated = await mutateJson(jsonFiles.posts, async (posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return { kind: 'not_found' };

      const current = migrateLegacyPost(posts[index], posts[index].clientId || fallbackClientId);
      const currentVersion = currentPostVersion(current);
      if (expectedVersion !== null && expectedVersion !== currentVersion) {
        return {
          kind: 'version_conflict',
          current: presentPost(current, fallbackClientId),
          currentVersion,
        };
      }
      const next = {
        ...current,
        ...updates,
        id: current.id,
        clientId: updates.clientId || current.clientId || fallbackClientId,
        updatedAt: new Date().toISOString(),
      };

      if (Array.isArray(updates.targets)) {
        next.targets = updates.targets.map((target) => normalizeTarget(target));
      } else if (!Array.isArray(next.targets) || next.targets.length === 0) {
        next.targets = buildTargetsFromBody(next, next.clientId);
      } else {
        next.targets = next.targets.map((target) => normalizeTarget(target));
      }

      const validation = await validatePostFormat(next, { uploadsDirectory: directories.uploads });
      if (!validation.valid) return { kind: 'invalid', validation };

      next.status = summarizePostStatus(next.targets);
      bumpPostVersion(next);
      posts[index] = next;
      return { kind: 'updated', post: presentPost(next, fallbackClientId), validation };
    });

    if (updated?.kind === 'not_found') return response.status(404).json({ error: '找不到要修改的貼文。' });
    if (updated?.kind === 'invalid') {
      return response.status(400).json({ error: updated.validation.errors[0].message, validation: updated.validation });
    }
    if (updated?.kind === 'version_conflict') {
      return response.status(409).json({
        error: '貼文已被更新，請先重新載入最新版本。',
        code: 'POST_VERSION_CONFLICT',
        currentVersion: updated.currentVersion,
        current: updated.current,
      });
    }
    const versionResult = await appendPostVersion({ post: updated.post, source: versionSource });
    response.json({ ...updated.post, validation: updated.validation, versionSaved: versionResult.created });
  });

  router.get('/posts/:postId/versions', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const posts = await readJson(jsonFiles.posts, []);
    const stored = posts.find((post) => post.id === request.params.postId);
    if (!stored) return response.status(404).json({ error: '找不到要查看版本的貼文。' });
    const post = migrateLegacyPost(stored, stored.clientId || fallbackClientId);
    const versions = activePostVersions(await listPostVersions(post.id));
    response.json({
      postId: post.id,
      currentVersion: currentPostVersion(post),
      versions,
    });
  });

  router.post('/posts/:postId/versions', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const posts = await readJson(jsonFiles.posts, []);
    const stored = posts.find((post) => post.id === request.params.postId);
    if (!stored) return response.status(404).json({ error: '找不到要建立版本的貼文。' });
    const post = migrateLegacyPost(stored, stored.clientId || fallbackClientId);
    const result = await appendPostVersion({
      post,
      source: request.body?.source === 'autosave' ? 'autosave' : 'manual',
    });
    response.status(result.created ? 201 : 200).json(result.record);
  });

  router.post('/posts/:postId/versions/:versionId/restore', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const version = await getPostVersion(request.params.postId, request.params.versionId);
    if (!version) return response.status(404).json({ error: '找不到要還原的貼文版本。' });
    const expectedVersion = request.body?.baseVersion === undefined
      ? null
      : Number(request.body.baseVersion);
    if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      return response.status(400).json({ error: '貼文版本格式不正確。', code: 'POST_VERSION_INVALID' });
    }

    const updated = await mutateJson(jsonFiles.posts, async (posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return { kind: 'not_found' };
      const current = migrateLegacyPost(posts[index], posts[index].clientId || fallbackClientId);
      const currentVersion = currentPostVersion(current);
      if (expectedVersion !== null && expectedVersion !== currentVersion) {
        return { kind: 'version_conflict', current: presentPost(current, fallbackClientId), currentVersion };
      }

      const content = version.content || {};
      const restoredTargets = Array.isArray(content.targets) && content.targets.length
        ? content.targets.map((target) => normalizeTarget({
          ...target,
          id: '',
          status: 'draft',
          scheduledAt: null,
          externalId: null,
          publishedAt: null,
          lastError: null,
          attempts: 0,
          lastAttemptAt: null,
          nextAttemptAt: null,
          lastAttemptId: null,
          publishAttempts: [],
        }))
        : buildTargetsFromBody(content, current.clientId || fallbackClientId)
          .map((target) => normalizeTarget({ ...target, id: '', status: 'draft' }));
      const next = {
        ...current,
        ...content,
        id: current.id,
        clientId: current.clientId || fallbackClientId,
        createdAt: current.createdAt,
        targets: restoredTargets,
        status: summarizePostStatus(restoredTargets),
        restoredFromVersionId: version.versionId,
        publishedAt: null,
        facebookPostId: null,
        externalId: null,
      };
      bumpPostVersion(next);
      const validation = await validatePostFormat(next, { uploadsDirectory: directories.uploads });
      if (!validation.valid) return { kind: 'invalid', validation };
      posts[index] = next;
      return { kind: 'updated', post: presentPost(next, fallbackClientId), validation };
    });

    if (updated?.kind === 'not_found') return response.status(404).json({ error: '找不到要還原的貼文。' });
    if (updated?.kind === 'version_conflict') {
      return response.status(409).json({
        error: '貼文已被更新，請先重新載入最新版本。',
        code: 'POST_VERSION_CONFLICT',
        currentVersion: updated.currentVersion,
        current: updated.current,
      });
    }
    if (updated?.kind === 'invalid') {
      return response.status(400).json({ error: updated.validation.errors[0].message, validation: updated.validation });
    }
    await appendPostVersion({ post: updated.post, source: 'restore' });
    response.json({ ...updated.post, validation: updated.validation, restoredFromVersionId: version.versionId });
  });
  router.post('/posts/:postId/validate', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const posts = await readJson(jsonFiles.posts, []);
    const stored = posts.find((post) => post.id === request.params.postId);
    if (!stored) return response.status(404).json({ error: '找不到要驗證的貼文。' });
    const post = migrateLegacyPost(stored, stored.clientId || fallbackClientId);
    const validation = await validatePostFormat(post, { uploadsDirectory: directories.uploads });
    response.json(validation);
  });

  return router;
}
