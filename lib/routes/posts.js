import { Router } from 'express';
import { readJson, mutateJson, makeId, jsonFiles } from '../store.js';
import { formatCopy, normalizePostCopy } from '../copy-format.js';
import {
  migrateLegacyPost,
  normalizeTarget,
  summarizePostStatus,
} from '../post-targets.js';
import { listClientsRaw } from '../clients.js';

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
  return normalizePostCopy(migrated);
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
    if (!body.godName || !body.facebook || !body.facebook.trim()) {
      return response.status(400).json({ error: '至少需要神明名稱與 Facebook 文案。' });
    }

    const fallbackClientId = await defaultClientId();
    const clientId = String(body.clientId || fallbackClientId || '').trim();
    if (!clientId) {
      return response.status(400).json({ error: '請先建立客戶再儲存貼文。' });
    }

    const targets = buildTargetsFromBody(body, clientId);
    const post = {
      id: makeId(),
      createdAt: new Date().toISOString(),
      clientId,
      status: summarizePostStatus(targets),
      godName: body.godName.trim(),
      postType: body.postType || 'work',
      extraNotes: body.extraNotes || '',
      channel: body.channel || targets[0]?.platformId || 'facebook',
      accountId: body.accountId || targets[0]?.accountId || '',
      contentType: body.contentType || targets[0]?.contentType || 'post',
      contentSettings: body.contentSettings && typeof body.contentSettings === 'object'
        ? body.contentSettings
        : (targets[0]?.contentSettings || {}),
      imagePath: body.imagePath || '',
      mediaPaths: Array.isArray(body.mediaPaths) && body.mediaPaths.length
        ? body.mediaPaths
        : (body.imagePath ? [body.imagePath] : []),
      facebook: formatCopy(body.facebook, 'facebook'),
      reel: formatCopy(body.reel, 'reel'),
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
      imageDescription: body.imageDescription || '',
      targets,
    };

    await mutateJson(jsonFiles.posts, (posts) => posts.push(post));
    response.status(201).json(presentPost(post, clientId));
  });

  router.patch('/posts/:postId', async (request, response) => {
    const updates = { ...request.body };
    if (Object.prototype.hasOwnProperty.call(updates, 'facebook')) {
      updates.facebook = formatCopy(updates.facebook, 'facebook');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'reel')) {
      updates.reel = formatCopy(updates.reel, 'reel');
    }

    const fallbackClientId = await defaultClientId();
    const updated = await mutateJson(jsonFiles.posts, (posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return null;

      const current = migrateLegacyPost(posts[index], posts[index].clientId || fallbackClientId);
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

      next.status = summarizePostStatus(next.targets);
      posts[index] = next;
      return presentPost(next, fallbackClientId);
    });

    if (!updated) return response.status(404).json({ error: '找不到這篇貼文。' });
    response.json(updated);
  });

  return router;
}
