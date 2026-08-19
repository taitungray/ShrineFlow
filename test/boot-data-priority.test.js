import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function sliceFn(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, name + ' must exist');
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.notEqual(end, -1, nextName + ' must follow ' + name);
  return source.slice(start, end);
}

test('core boot lists exclude Meta insights and inbox so publishing records can paint first', async () => {
  const app = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');
  const core = sliceFn(app, 'fetchCoreLists', 'fetchSecondaryLists');
  const secondary = sliceFn(app, 'fetchSecondaryLists', 'renderSecondaryLists');
  const refresh = sliceFn(app, 'refreshLists', 'applyClientAccounts');
  const load = sliceFn(app, 'loadData', 'initApp');

  assert.match(core, /\/api\/posts/, 'posts belong on the first paint path');
  assert.match(core, /\/api\/schedule/, 'schedule belongs on the first paint path');
  assert.doesNotMatch(core, /\/api\/insights/, 'insights must not block posts');
  assert.doesNotMatch(core, /\/api\/inbox/, 'inbox must not block posts');
  assert.doesNotMatch(core, /\/api\/remote-schedule/, 'remote schedule must not block posts');

  assert.match(secondary, /\/api\/insights/, 'insights stay on the background path');
  assert.match(secondary, /\/api\/inbox/, 'inbox stays on the background path');

  assert.match(refresh, /await fetchCoreLists\(\)/, 'refresh paints after core fetch');
  assert.match(refresh, /renderCoreLists\(\)/, 'refresh renders core before Meta extras');
  assert.match(refresh, /void hydrateBackgroundLists/, 'refresh must not await Meta extras');

  assert.match(load, /await fetchCoreLists\(\)/, 'first load fetches posts before Meta extras');
  assert.match(load, /renderCoreLists\(\)/, 'first load paints lists before Meta extras');
  assert.match(load, /void hydrateBackgroundLists/, 'first load must not await Meta extras');
});
