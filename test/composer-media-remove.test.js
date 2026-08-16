import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function ruleBodies(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))].map((match) => match[1]);
}

function pxValue(body, property) {
  const match = body.match(new RegExp(`${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  return match ? Number(match[1]) : 0;
}

test('composer gallery cards expose a 44px per-item remove control', async () => {
  const js = await fs.readFile(path.join(root, 'public', 'modules', 'upload.js'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public', 'style.css'), 'utf8');

  assert.match(js, /data-media-remove/, 'each selected media card needs a remove action');
  assert.match(js, /export function removeSelectedMedia/, 'remove must splice one item instead of clearing the whole set');
  assert.match(js, /\[data-media-move\], \[data-media-remove\]/, 'remove clicks must not start reorder drag');
  assert.match(js, /syncGeneratedMediaFromSelection/, 'removing a card must keep generated mediaPaths in sync');

  const remove = ruleBodies(css, '.media-remove-button').join('\n');
  assert.ok(pxValue(remove, 'width') >= 44, 'remove hit area must be ≥44px wide');
  assert.ok(pxValue(remove, 'height') >= 44, 'remove hit area must be ≥44px tall');
  assert.match(remove, /position\s*:\s*absolute/, 'remove sits on the card, not in a distant toolbar');
});

test('draft payload prefers remaining selected media after a card is removed', async () => {
  const editor = await fs.readFile(path.join(root, 'public', 'modules', 'editor.js'), 'utf8');
  assert.match(
    editor,
    /state\.selectedMediaItems\.length\s*\?\s*selectedServerPaths/,
    'empty remaining selection must not fall back to the pre-delete generated paths',
  );
});
