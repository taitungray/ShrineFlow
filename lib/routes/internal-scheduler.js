import crypto from 'node:crypto';
import { Router } from 'express';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(request) {
  const value = String(request.get('Authorization') || '');
  return /^Bearer\s+\S+$/i.test(value) ? value.slice(value.indexOf(' ') + 1).trim() : '';
}

export function createSchedulerTriggerRouter({
  processDueSchedules,
  env = process.env,
} = {}) {
  const router = Router();

  router.post('/internal/scheduler/tick', async (request, response) => {
    const expectedToken = String(env.SHRINEFLOW_SCHEDULER_TOKEN || '').trim();
    const providedToken = String(request.get('X-ShrineFlow-Scheduler-Token') || '').trim();
    const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
    const allowPlatformAuth = String(env.SHRINEFLOW_SCHEDULER_ALLOW_PLATFORM_AUTH || '').toLowerCase() === 'true';
    const tokenAuthorized = expectedToken && safeEqual(providedToken, expectedToken);
    const platformAuthorized = production && allowPlatformAuth && Boolean(bearerToken(request));

    if (expectedToken ? !tokenAuthorized : (production ? !platformAuthorized : false)) {
      return response.status(expectedToken ? 401 : 503).json({
        error: expectedToken
          ? '?????????'
          : '???????????????',
        code: 'SCHEDULER_TRIGGER_UNAUTHORIZED',
      });
    }

    if (typeof processDueSchedules !== 'function') {
      return response.status(503).json({ error: '?????????', code: 'SCHEDULER_UNAVAILABLE' });
    }

    try {
      const result = await processDueSchedules(new Date());
      return response.json({ ok: true, ...result });
    } catch (error) {
      return response.status(500).json({
        error: error.message || '???????',
        code: 'SCHEDULER_TICK_FAILED',
      });
    }
  });

  return router;
}
