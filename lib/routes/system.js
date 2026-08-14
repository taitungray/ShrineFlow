import { Router } from 'express';
import {
  cleanupOrphanUploads,
  createBackup,
  listBackups,
  restoreBackup,
  scanStorageHealth,
} from '../storage-management.js';
import { listNotifications, markNotificationRead } from '../notifications.js';
import { listErrorLogs } from '../error-log.js';
import { inspectSystemHealth } from '../system-health.js';
import { inspectDeploymentReadiness } from '../deployment-readiness.js';

export function createSystemRouter({
  getHealth = inspectSystemHealth,
  getReadiness = inspectDeploymentReadiness,
  createBackupImpl = createBackup,
} = {}) {
  const router = Router();

  router.post('/system/backup', async (request, response) => {
    try {
      const manifest = await createBackupImpl({ includeMedia: request.body?.includeMedia === true });
      response.status(201).json(manifest);
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || '建立備份失敗。' });
    }
  });

  router.get('/system/backups', async (_request, response) => {
    response.json(await listBackups());
  });

  router.post('/system/restore', async (request, response) => {
    try {
      if (!request.body?.backupId) return response.status(400).json({ error: '請指定要還原的備份。' });
      const result = await restoreBackup(request.body.backupId, {
        includeMedia: request.body.includeMedia === true,
      });
      response.json(result);
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || '還原備份失敗。' });
    }
  });

  router.get('/system/storage-health', async (_request, response) => {
    response.json(await scanStorageHealth());
  });

  router.get('/system/health', async (_request, response) => {
    try {
      response.json(await getHealth());
    } catch (error) {
      response.status(503).json({ status: 'unavailable', error: error.message || '無法讀取系統健康狀態。' });
    }
  });

  router.get('/system/readiness', async (_request, response) => {
    try {
      const readiness = await getReadiness();
      response.status(readiness.status === 'blocked' ? 503 : 200).json(readiness);
    } catch (error) {
      response.status(503).json({ status: 'blocked', error: error.message || '無法讀取部署前置檢查。' });
    }
  });

  router.post('/system/media-cleanup', async (request, response) => {
    try {
      const result = await cleanupOrphanUploads({ confirm: request.body?.confirm === true });
      response.json(result);
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || '清理未使用素材失敗。' });
    }
  });

  router.get('/system/notifications', async (request, response) => {
    const unreadOnly = String(request.query.unreadOnly || '').toLowerCase() === 'true';
    const limit = Number(request.query.limit || 50);
    const clientId = String(request.query.clientId || '').trim();
    response.json(await listNotifications({ unreadOnly, limit, clientId }));
  });

  router.post('/system/notifications/:notificationId/read', async (request, response) => {
    const notification = await markNotificationRead(request.params.notificationId);
    if (!notification) return response.status(404).json({ error: '找不到通知。' });
    response.json(notification);
  });

  router.get('/system/error-log', async (request, response) => {
    const limit = Number(request.query.limit || 50);
    const scope = String(request.query.scope || '').trim();
    response.json(await listErrorLogs({ limit, scope }));
  });

  return router;
}
