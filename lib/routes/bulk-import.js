import { Router } from 'express';

import { directories } from '../store.js';
import { appendPostVersion } from '../post-history.js';
import { assertCollectionCapacity } from '../storage-policy.js';
import { listClientsRaw } from '../clients.js';
import { getRepositories } from '../repositories.js';
import { canAccessClient, requestedOrAccessibleClientId } from '../request-scope.js';
import { buildBulkDraft, validateBulkCsv } from '../bulk-import.js';

export function createBulkImportRouter({
  repositories = getRepositories(),
  listClients = listClientsRaw,
  validate = validateBulkCsv,
} = {}) {
  const router = Router();

  router.post('/bulk-import/preview', async (request, response) => {
    try {
      const body = request.body || {};
      const clientId = requestedOrAccessibleClientId(request, body.clientId, '');
      if (!clientId) return response.status(400).json({ error: '請先選擇品牌。', code: 'CLIENT_REQUIRED' });
      if (!canAccessClient(request, clientId)) return response.status(403).json({ error: '無法存取此品牌。', code: 'CLIENT_FORBIDDEN' });
      const clients = await listClients(repositories);
      if (!clients.some((client) => client.id === clientId)) return response.status(404).json({ error: '找不到品牌。', code: 'CLIENT_NOT_FOUND' });
      const result = await validate(body.csv || '', {
        clientId,
        uploadsDirectory: directories.uploads,
      });
      response.json({ clientId, ...result });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || 'CSV 預覽失敗。', code: error.code || 'BULK_IMPORT_PREVIEW_FAILED' });
    }
  });

  router.post('/bulk-import/commit', async (request, response) => {
    try {
      const body = request.body || {};
      const clientId = requestedOrAccessibleClientId(request, body.clientId, '');
      if (!clientId) return response.status(400).json({ error: '請先選擇品牌。', code: 'CLIENT_REQUIRED' });
      if (!canAccessClient(request, clientId)) return response.status(403).json({ error: '無法存取此品牌。', code: 'CLIENT_FORBIDDEN' });
      const clients = await listClients(repositories);
      if (!clients.some((client) => client.id === clientId)) return response.status(404).json({ error: '找不到品牌。', code: 'CLIENT_NOT_FOUND' });
      const preview = await validate(body.csv || '', {
        clientId,
        uploadsDirectory: directories.uploads,
      });
      if (!preview.valid) {
        return response.status(400).json({
          error: 'CSV 尚未通過逐列驗證，未建立任何貼文。',
          code: 'BULK_IMPORT_VALIDATION_FAILED',
          preview,
        });
      }
      const now = new Date();
      const drafts = preview.rows.map((row) => buildBulkDraft(row, { clientId, now }));
      await repositories.posts.mutate((records) => {
        assertCollectionCapacity('posts', records.length, drafts.length);
        records.push(...drafts);
      });
      await Promise.all(drafts.map((draft) => appendPostVersion({ post: draft, source: 'bulk_import' })));
      response.status(201).json({
        clientId,
        dryRun: false,
        createdCount: drafts.length,
        drafts,
        preview,
      });
    } catch (error) {
      response.status(error.status || 500).json({ error: error.message || 'CSV 寫入失敗。', code: error.code || 'BULK_IMPORT_COMMIT_FAILED' });
    }
  });

  return router;
}
