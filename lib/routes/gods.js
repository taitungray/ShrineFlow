import { Router } from 'express';
import { readJson, mutateJson, jsonFiles } from '../store.js';
import { assertCollectionCapacity } from '../storage-policy.js';

export function createGodsRouter() {
  const router = Router();

  router.get('/gods', async (_request, response) => {
    response.json(await readJson(jsonFiles.gods, []));
  });

  router.post('/gods', async (request, response) => {
    const { name, tags = [], intro = '' } = request.body || {};
    if (!name || !name.trim()) return response.status(400).json({ error: '請填寫神明名稱。' });
    const god = { name: name.trim(), tags, intro: intro.trim() };
    const result = await mutateJson(jsonFiles.gods, (gods) => {
      if (gods.some((item) => item.name === god.name)) return { conflict: true };
      assertCollectionCapacity('gods', gods.length, 1);
      gods.push(god);
      return { conflict: false };
    }, []);
    if (result.conflict) return response.status(409).json({ error: '這個神明已經存在。' });
    response.status(201).json(god);
  });

  return router;
}
