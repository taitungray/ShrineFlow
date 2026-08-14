import { Router } from 'express';
import {
  cleanupOrphanUploads,
  createBackup,
  listBackups,
  restoreBackup,
  scanStorageHealth,
} from '../storage-management.js';
import { listNotifications, markNotificationRead } from '../notifications.js';

export function createSystemRouter() {
  const router = Router();

  router.post('/system/backup', async (request, response) => {
    try {
      const manifest = await createBackup({ includeMedia: request.body?.includeMedia === true });
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

  return router;
}
