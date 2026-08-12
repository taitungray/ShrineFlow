import { Router } from 'express';

export function createConfigRouter({ aiService, facebookPublisher, publishingPlatforms, publishingAccounts, schedulerIntervalMs }) {
  const router = Router();

  router.get('/config', (_request, response) => {
    response.json({
      aiConfigured: aiService.configured,
      provider: aiService.provider,
      model: aiService.models.join(', '),
      facebookConfigured: facebookPublisher.configured,
      facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
      facebookSchedulerIntervalSeconds: schedulerIntervalMs / 1000,
      publishingPlatforms,
      publishingAccounts,
    });
  });

  router.get('/accounts', (_request, response) => {
    response.json(publishingAccounts);
  });

  router.get('/facebook/status', async (_request, response) => {
    if (!facebookPublisher.configured) return response.json({ configured: false, connected: false });
    try {
      const page = await facebookPublisher.verify();
      response.json({ configured: true, connected: true, page });
    } catch (error) {
      response.status(502).json({
        configured: true,
        connected: false,
        error: error.message || '無法驗證 Facebook 粉專連線。',
      });
    }
  });

  return router;
}
