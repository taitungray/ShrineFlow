import { Router } from 'express';

import { directories } from '../store.js';
import { listClientsRaw } from '../clients.js';
import { getRepositories } from '../repositories.js';
import { canAccessClient, requestedOrAccessibleClientId } from '../request-scope.js';
import { validateBulkCsv } from '../bulk-import.js';

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

  return router;
}
