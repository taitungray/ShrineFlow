import { Router } from 'express';
import { readJson, mutateJson, jsonFiles } from '../store.js';
import { resolvePostMediaPaths } from '../upload.js';
import { normalizePostCopy } from '../copy-format.js';
import { FacebookPublishError } from '../facebook.js';

export function createPublishRouter({ facebookPublisher }) {
  const router = Router();

  router.post('/publish/facebook', async (request, response) => {
    if (!facebookPublisher.configured) {
      return response.status(503).json({
        error: 'Facebook 尚未設定。請在 .env 填入 FACEBOOK_PAGE_ID 與 FACEBOOK_PAGE_ACCESS_TOKEN。',
      });
    }
    const posts = await readJson(jsonFiles.posts, []);
    const post = posts.find((item) => item.id === request.body?.postId);
    if (!post) return response.status(404).json({ error: '找不到要發布的貼文。' });

    try {
      const result = await facebookPublisher.publish(normalizePostCopy(post), {
        mediaFilePaths: resolvePostMediaPaths(post),
      });
      const publishedAt = new Date().toISOString();
      await mutateJson(jsonFiles.posts, (records) => {
        const target = records.find((item) => item.id === post.id);
        if (target) Object.assign(target, { status: 'published', publishedAt, facebookPostId: result.externalId });
      });
      response.json({ ...result, publishedAt });
    } catch (error) {
      const status = error instanceof FacebookPublishError && error.status ? 502 : 500;
      response.status(status).json({ error: error.message || 'Facebook 發布失敗。' });
    }
  });

  return router;
}
