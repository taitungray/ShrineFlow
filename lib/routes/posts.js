import { Router } from 'express';
import { readJson, mutateJson, makeId, jsonFiles } from '../store.js';
import { formatCopy, normalizePostCopy } from '../copy-format.js';

export function createPostsRouter() {
  const router = Router();

  router.get('/posts', async (_request, response) => {
    const posts = await readJson(jsonFiles.posts, []);
    response.json(posts.map(normalizePostCopy).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  });

  router.post('/posts', async (request, response) => {
    const body = request.body || {};
    if (!body.godName || !body.facebook || !body.facebook.trim()) {
      return response.status(400).json({ error: '至少需要神明名稱與 Facebook 文案。' });
    }
    const post = {
      id: makeId(),
      createdAt: new Date().toISOString(),
      status: 'draft',
      godName: body.godName.trim(),
      postType: body.postType || 'work',
      extraNotes: body.extraNotes || '',
      channel: body.channel || 'facebook',
      accountId: body.accountId || '',
      contentType: body.contentType || 'post',
      contentSettings: body.contentSettings && typeof body.contentSettings === 'object' ? body.contentSettings : {},
      imagePath: body.imagePath || '',
      mediaPaths: Array.isArray(body.mediaPaths) && body.mediaPaths.length
        ? body.mediaPaths
        : (body.imagePath ? [body.imagePath] : []),
      facebook: formatCopy(body.facebook, 'facebook'),
      reel: formatCopy(body.reel, 'reel'),
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
      imageDescription: body.imageDescription || '',
    };
    await mutateJson(jsonFiles.posts, (posts) => posts.push(post));
    response.status(201).json(post);
  });

  router.patch('/posts/:postId', async (request, response) => {
    const updates = { ...request.body };
    if (Object.prototype.hasOwnProperty.call(updates, 'facebook')) updates.facebook = formatCopy(updates.facebook, 'facebook');
    if (Object.prototype.hasOwnProperty.call(updates, 'reel')) updates.reel = formatCopy(updates.reel, 'reel');
    const updated = await mutateJson(jsonFiles.posts, (posts) => {
      const index = posts.findIndex((post) => post.id === request.params.postId);
      if (index < 0) return null;
      posts[index] = { ...posts[index], ...updates, id: posts[index].id, updatedAt: new Date().toISOString() };
      return normalizePostCopy(posts[index]);
    });
    if (!updated) return response.status(404).json({ error: '找不到這篇貼文。' });
    response.json(updated);
  });

  return router;
}
