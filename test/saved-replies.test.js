import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { createSavedRepliesRouter } from '../lib/routes/saved-replies.js';

function repository(initial = []) {
  const records = initial.map((record) => ({ ...record }));
  return {
    async list() { return records.map((record) => ({ ...record })); },
    async getById(id) { return records.find((record) => record.id === id) || null; },
    async mutate(mutator) { return mutator(records); },
  };
}

test('Saved replies are client-scoped and can be edited without message storage', async () => {
  const repositories = { savedReplies: repository([]) };
  const app = express();
  app.use(express.json());
  app.use('/api', createSavedRepliesRouter({
    repositories,
    listClients: async () => [{ id: 'client-replies', name: 'Brand' }],
  }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/saved-replies`;
    const createdResponse = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-replies',
        title: '感謝支持',
        shortcut: 'thanks',
        text: '謝謝你的支持，我們會繼續努力！',
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.clientId, 'client-replies');

    const updatedResponse = await fetch(`${base}/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '謝謝你的支持！' }),
    });
    assert.equal(updatedResponse.status, 200);

    const listResponse = await fetch(`${base}?clientId=client-replies`);
    const list = await listResponse.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].text, '謝謝你的支持！');
    assert.equal(JSON.stringify(list).includes('message body'), false);

    const deleted = await fetch(`${base}/${created.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await (await fetch(`${base}?clientId=client-replies`)).json(), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
