import { Router } from 'express';
import { readJson, writeJson, jsonFiles } from '../store.js';

export function createGodsRouter() {
  const router = Router();

  router.get('/gods', async (_request, response) => {
    response.json(await readJson(jsonFiles.gods, []));
  });

  router.post('/gods', async (request, response) => {
    const { name, tags = [], intro = '' } = request.body || {};
    if (!name || !name.trim()) return response.status(400).json({ error: '請填寫神明名稱。' });
    const gods = await readJson(jsonFiles.gods, []);
    if (gods.some((god) => god.name === name.trim())) {
      return response.status(409).json({ error: '這個神明已經存在。' });
    }
    const god = { name: name.trim(), tags, intro: intro.trim() };
    gods.push(god);
    await writeJson(jsonFiles.gods, gods);
    response.status(201).json(god);
  });

  return router;
}
