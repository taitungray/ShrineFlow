import { Router } from 'express';
import { makeId, directories } from '../store.js';
import { getRepositories } from '../repositories.js';
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
import { addPostLifecycleEvent, activePostTargetStatuses, isPostArchived, isPostHidden, isPostIdea, normalizeContentStage } from '../post-lifecycle.js';
import { invalidateApproval } from '../approval-workflow.js';
import { filterAccessibleClients, requestedOrAccessibleClientId } from '../request-scope.js';

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
    contentStage: normalizeContentStage(normalized.contentStage),
  };
}

function cloneTargetAsDraft(target) {
  return normalizeTarget({
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
  });
}

function duplicatePostAsDraft(source, clientId) {
  const now = new Date().toISOString();
  const targets = (Array.isArray(source.targets) ? source.targets : []).map(cloneTargetAsDraft);
  const duplicate = {
    ...source,
    id: makeId(),
    clientId,
    createdAt: now,
    updatedAt: now,
    version: 1,
    status: 'draft',
    approvalState: 'draft',
    createdBy: source.createdBy || null,
    updatedBy: source.updatedBy || null,
    archivedAt: null,
    archivedFromStatus: null,
    restoredAt: null,
    hiddenAt: null,
    restoredFromVersionId: null,
    duplicatedFrom: source.id,
    lifecycleEvents: [],
    publishedAt: null,
    facebookPostId: null,
    externalId: null,
    lastError: null,
    attempts: 0,
    publishAttempts: [],
    targets,
  };
  addPostLifecycleEvent(duplicate, 'duplicated', { sourcePostId: source.id }, now);
  return duplicate;
}
export function createPostsRouter({ repositories = getRepositories() } = {}) {
  const router = Router();

  router.get('/posts', async (request, response) => {
    const clientId = String(request.query.clientId || '').trim();
    const fallbackClientId = await defaultClientId();
    const posts = await repositories.posts.list();
    const presented = filterAccessibleClients(
      posts.map((post) => presentPost(post, fallbackClientId)),
      request,
      clientId,
    )
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    response.json(presented);
  });

  router.post('/posts', async (request, response) => {
    const body = request.body || {};
    const contentTopic = String(body.contentTopic || body.godName || '').trim();
    const contentStage = normalizeContentStage(body.contentStage);
    if (!contentTopic || (contentStage !== 'idea' && (!body.facebook || !body.facebook.trim()))) {
      return response.status(400).json({ error: '請填寫主題與 Facebook 文案。' });
    }

    const fallbackClientId = await defaultClientId();
    const clientId = requestedOrAccessibleClientId(request, body.clientId, fallbackClientId);
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
      createdBy: request.actor?.uid || request.actor?.email || null,
      updatedBy: request.actor?.uid || request.actor?.email || null,
      approvalState: 'draft',
      contentStage,
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

    const validation = contentStage === 'idea'
      ? { valid: true, errors: [], warnings: [], targets: [] }
      : await validatePostFormat(post, { uploadsDirectory: directories.uploads });
    if (!validation.valid) {
      return response.status(400).json({ error: validation.errors[0].message, validation });
    }

    await repositories.posts.mutate((posts) => {
      assertCollectionCapacity('posts', posts.length, 1);
      posts.push(post);
    });
    await appendPostVersion({ post, source: 'created' });
    response.status(201).json({ ...presentPost(post, clientId), validation });
  });

  router.post('/posts/:postId/archive', async (request, response) => {
    const updated = await repositories.posts.mutate((posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return { kind: 'not_found' };
      const current = migrateLegacyPost(posts[index], posts[index].clientId || '');
      if (isPostArchived(current)) return { kind: 'already_archived', post: presentPost(current) };
      const blockers = activePostTargetStatuses(current);
      if (blockers.length) return { kind: 'blocked', blockers };
      const archivedAt = new Date().toISOString();
      const archivedFromStatus = summarizePostStatus(current.targets);
      current.status = 'archived';
      current.archivedAt = archivedAt;
      current.archivedFromStatus = archivedFromStatus;
      current.restoredAt = null;
      bumpPostVersion(current, archivedAt);
      addPostLifecycleEvent(current, 'archived', { fromStatus: archivedFromStatus }, archivedAt);
      posts[index] = current;
      return { kind: 'updated', post: presentPost(current) };
    });
    if (updated.kind === 'not_found') return response.status(404).json({ error: '找不到要封存的貼文。' });
    if (updated.kind === 'already_archived') return response.json({ ...updated.post, alreadyArchived: true });
    if (updated.kind === 'blocked') {
      return response.status(409).json({
        error: '排程或發布中的貼文不能直接封存，請先取消排程或等待發布完成。',
        code: 'POST_LIFECYCLE_BLOCKED',
        blockers: updated.blockers,
      });
    }
    await appendPostVersion({ post: updated.post, source: 'archive', force: true });
    response.json({ ...updated.post, lifecycleAction: 'archived' });
  });

  router.post('/posts/:postId/restore', async (request, response) => {
    const updated = await repositories.posts.mutate((posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return { kind: 'not_found' };
      const current = migrateLegacyPost(posts[index], posts[index].clientId || '');
      if (!isPostArchived(current)) return { kind: 'not_archived', post: presentPost(current) };
      const restoredAt = new Date().toISOString();
      const restoredFromStatus = current.archivedFromStatus || summarizePostStatus(current.targets);
      current.status = summarizePostStatus(current.targets);
      current.archivedAt = null;
      current.archivedFromStatus = null;
      current.restoredAt = restoredAt;
      bumpPostVersion(current, restoredAt);
      addPostLifecycleEvent(current, 'restored', { fromStatus: restoredFromStatus }, restoredAt);
      posts[index] = current;
      return { kind: 'updated', post: presentPost(current) };
    });
    if (updated.kind === 'not_found') return response.status(404).json({ error: '找不到要還原的貼文。' });
    if (updated.kind === 'not_archived') return response.status(409).json({ error: '這篇貼文目前不是封存狀態。', code: 'POST_NOT_ARCHIVED' });
    await appendPostVersion({ post: updated.post, source: 'restore', force: true });
    response.json({ ...updated.post, lifecycleAction: 'restored' });
  });

  router.post('/posts/:postId/hide', async (request, response) => {
    const updated = await repositories.posts.mutate((posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return { kind: 'not_found' };
      const current = migrateLegacyPost(posts[index], posts[index].clientId || '');
      if (isPostHidden(current)) return { kind: 'already_hidden', post: presentPost(current) };
      const hiddenAt = new Date().toISOString();
      current.hiddenAt = hiddenAt;
      addPostLifecycleEvent(current, 'hidden', { fromStatus: current.status }, hiddenAt);
      posts[index] = current;
      return { kind: 'updated', post: presentPost(current) };
    });
    if (updated.kind === 'not_found') return response.status(404).json({ error: '找不到要隱藏的貼文。' });
    response.json({ ...updated.post, alreadyHidden: updated.kind === 'already_hidden', lifecycleAction: 'hidden' });
  });

  router.post('/posts/:postId/unhide', async (request, response) => {
    const updated = await repositories.posts.mutate((posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return { kind: 'not_found' };
      const current = migrateLegacyPost(posts[index], posts[index].clientId || '');
      if (!isPostHidden(current)) return { kind: 'not_hidden', post: presentPost(current) };
      const unhiddenAt = new Date().toISOString();
      current.hiddenAt = null;
      addPostLifecycleEvent(current, 'unhidden', { fromStatus: current.status }, unhiddenAt);
      posts[index] = current;
      return { kind: 'updated', post: presentPost(current) };
    });
    if (updated.kind === 'not_found') return response.status(404).json({ error: '找不到要取消隱藏的貼文。' });
    if (updated.kind === 'not_hidden') return response.status(409).json({ error: '這篇貼文目前不是隱藏狀態。', code: 'POST_NOT_HIDDEN' });
    response.json({ ...updated.post, lifecycleAction: 'unhidden' });
  });

  router.post('/posts/:postId/duplicate', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const posts = await repositories.posts.list();
    const source = posts.find((post) => post.id === request.params.postId);
    if (!source) return response.status(404).json({ error: '找不到要複製的貼文。' });
    const sourcePost = migrateLegacyPost(source, source.clientId || fallbackClientId);
    const clientId = sourcePost.clientId || fallbackClientId;
    if (!clientId) return response.status(400).json({ error: '複製貼文需要指定品牌。' });
    const duplicate = duplicatePostAsDraft(sourcePost, clientId);
    const validation = await validatePostFormat(duplicate, { uploadsDirectory: directories.uploads });
    if (!validation.valid) return response.status(400).json({ error: validation.errors[0].message, validation });
    await repositories.posts.mutate((records) => {
      assertCollectionCapacity('posts', records.length, 1);
      records.push(duplicate);
    });
    await appendPostVersion({ post: duplicate, source: 'duplicate' });
    response.status(201).json({ ...presentPost(duplicate, clientId), validation, lifecycleAction: 'duplicated' });
  });
  router.post('/posts/:postId/repurpose', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const posts = await repositories.posts.list();
    const source = posts.find((post) => post.id === request.params.postId);
    if (!source) return response.status(404).json({ error: '找不到要再製的貼文。' });
    const sourcePost = migrateLegacyPost(source, source.clientId || fallbackClientId);
    if (!(sourcePost.targets || []).some((target) => target.status === 'published')) {
      return response.status(409).json({ error: '只有已發布內容可以建立再製草稿。', code: 'POST_NOT_PUBLISHED' });
    }
    const clientId = sourcePost.clientId || fallbackClientId;
    if (!clientId) return response.status(400).json({ error: '建立再製草稿需要指定品牌。' });
    const duplicate = duplicatePostAsDraft(sourcePost, clientId);
    duplicate.contentStage = 'draft';
    const validation = await validatePostFormat(duplicate, { uploadsDirectory: directories.uploads });
    if (!validation.valid) return response.status(400).json({ error: validation.errors[0].message, validation });
    await repositories.posts.mutate((records) => {
      assertCollectionCapacity('posts', records.length, 1);
      records.push(duplicate);
    });
    await appendPostVersion({ post: duplicate, source: 'repurpose' });
    response.status(201).json({
      ...presentPost(duplicate, clientId),
      validation,
      lifecycleAction: 'repurposed',
      sourcePostId: sourcePost.id,
    });
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
    const updated = await repositories.posts.mutate(async (posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return { kind: 'not_found' };

      const current = migrateLegacyPost(posts[index], posts[index].clientId || fallbackClientId);
      if (isPostArchived(current)) return { kind: 'archived', current: presentPost(current, fallbackClientId), currentVersion: currentPostVersion(current) };
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
        clientId: current.clientId || fallbackClientId,
        updatedAt: new Date().toISOString(),
      };
      next.updatedBy = request.actor?.uid || request.actor?.email || current.updatedBy || null;
      invalidateApproval(next, request.actor, next.updatedAt);

      if (Array.isArray(updates.targets)) {
        next.targets = updates.targets.map((target) => normalizeTarget(target));
      } else if (!Array.isArray(next.targets) || next.targets.length === 0) {
        next.targets = buildTargetsFromBody(next, next.clientId);
      } else {
        next.targets = next.targets.map((target) => normalizeTarget(target));
      }

      next.contentStage = normalizeContentStage(next.contentStage);
      const validation = isPostIdea(next)
        ? { valid: true, errors: [], warnings: [], targets: [] }
        : await validatePostFormat(next, { uploadsDirectory: directories.uploads });
      if (!validation.valid) return { kind: 'invalid', validation };

      next.status = summarizePostStatus(next.targets);
      bumpPostVersion(next);
      posts[index] = next;
      return { kind: 'updated', post: presentPost(next, fallbackClientId), validation };
    });

    if (updated?.kind === 'not_found') return response.status(404).json({ error: '找不到要修改的貼文。' });
    if (updated?.kind === 'archived') return response.status(409).json({ error: '封存中的貼文不能直接編輯，請先還原。', code: 'POST_ARCHIVED', current: updated.current });
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
    const posts = await repositories.posts.list();
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
    const posts = await repositories.posts.list();
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

    const updated = await repositories.posts.mutate(async (posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return { kind: 'not_found' };
      const current = migrateLegacyPost(posts[index], posts[index].clientId || fallbackClientId);
      if (isPostArchived(current)) return { kind: 'archived', current: presentPost(current, fallbackClientId), currentVersion: currentPostVersion(current) };
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
      next.updatedBy = request.actor?.uid || request.actor?.email || current.updatedBy || null;
      invalidateApproval(next, request.actor);
      bumpPostVersion(next);
      addPostLifecycleEvent(next, 'restored_version', { sourceVersionId: version.versionId });
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
    await appendPostVersion({ post: updated.post, source: 'restore', force: true });
    response.json({ ...updated.post, validation: updated.validation, restoredFromVersionId: version.versionId });
  });
  router.post('/posts/:postId/validate', async (request, response) => {
    const fallbackClientId = await defaultClientId();
    const posts = await repositories.posts.list();
    const stored = posts.find((post) => post.id === request.params.postId);
    if (!stored) return response.status(404).json({ error: '找不到要驗證的貼文。' });
    const post = migrateLegacyPost(stored, stored.clientId || fallbackClientId);
    const validation = await validatePostFormat(post, { uploadsDirectory: directories.uploads });
    response.json(validation);
  });

  return router;
}
