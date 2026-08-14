import { Router } from 'express';
import { getClientRaw, listClientsRaw } from '../clients.js';
import { getRepositories } from '../repositories.js';
import { migrateLegacyPost } from '../post-targets.js';
import { canAccessClient, requestedOrAccessibleClientId } from '../request-scope.js';
import { analyzeBestTimes, publishedTargetRecords } from '../best-times.js';

export function createBestTimesRouter({
  getClient = getClientRaw,
  listClients = listClientsRaw,
  repositories = getRepositories(),
  listPosts = () => repositories.posts.list(),
} = {}) {
  const router = Router();

  router.get('/insights/best-times', async (request, response) => {
    const clientId = requestedOrAccessibleClientId(request, request.query.clientId);
    const client = clientId
      ? await getClient(clientId)
      : (await listClients()).find((item) => canAccessClient(request, item.id));
    if (clientId && !client) return response.status(404).json({ error: '找不到品牌。' });
    if (!client) {
      return response.json({
        status: 'insufficient_data',
        clientId: '',
        sampleCount: 0,
        minimumSamples: 10,
        slots: [],
        source: 'local_published_targets',
      });
    }
    const posts = (await listPosts()).map((post) => migrateLegacyPost(post, post.clientId || client.id));
    const result = analyzeBestTimes(publishedTargetRecords(posts), {
      clientId: client.id,
      platformId: String(request.query.platform || '').trim(),
      accountId: String(request.query.accountId || '').trim(),
      timeZone: String(request.query.timeZone || 'Asia/Taipei').trim() || 'Asia/Taipei',
      minSamples: request.query.minSamples,
    });
    return response.json({
      ...result,
      clientId: client.id,
      filters: {
        platformId: String(request.query.platform || '').trim(),
        accountId: String(request.query.accountId || '').trim(),
      },
      fetchedAt: new Date().toISOString(),
    });
  });

  return router;
}
