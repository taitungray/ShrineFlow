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

function authorize(request, env) {
  const expectedToken = String(env.SHRINEFLOW_SCHEDULER_TOKEN || '').trim();
  const providedToken = String(request.get('X-ShrineFlow-Scheduler-Token') || '').trim();
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const allowPlatformAuth = String(env.SHRINEFLOW_SCHEDULER_ALLOW_PLATFORM_AUTH || '').toLowerCase() === 'true';
  const tokenAuthorized = expectedToken && safeEqual(providedToken, expectedToken);
  const platformAuthorized = production && allowPlatformAuth && Boolean(bearerToken(request));
  if (expectedToken ? !tokenAuthorized : (production ? !platformAuthorized : false)) {
    return {
      status: expectedToken ? 401 : 503,
      body: {
        error: expectedToken ? 'Scheduler token is invalid.' : 'Scheduler authentication is not configured.',
        code: 'SCHEDULER_TRIGGER_UNAUTHORIZED',
      },
    };
  }
  return null;
}

function registerJob(router, path, handler, env) {
  router.post(path, async (request, response) => {
    const authorizationError = authorize(request, env);
    if (authorizationError) return response.status(authorizationError.status).json(authorizationError.body);
    if (typeof handler !== 'function') {
      return response.status(503).json({ error: 'Scheduler job is unavailable.', code: 'SCHEDULER_UNAVAILABLE' });
    }
    try {
      const result = await handler(request);
      return response.json({ ok: true, ...(result || {}) });
    } catch (error) {
      return response.status(500).json({
        error: error.message || 'Scheduler job failed.',
        code: 'SCHEDULER_TICK_FAILED',
      });
    }
  });
}

export function createSchedulerTriggerRouter({
  processDueSchedules,
  exportBackup,
  cleanupMedia,
  env = process.env,
} = {}) {
  const router = Router();
  const tick = (request) => processDueSchedules?.(new Date(), request);
  registerJob(router, ['/internal/scheduler/tick', '/internal/scheduler/publish-due'], tick, env);
  registerJob(router, '/internal/scheduler/export-backup', () => exportBackup?.(), env);
  registerJob(router, '/internal/scheduler/cleanup-media', () => cleanupMedia?.(), env);
  return router;
}
