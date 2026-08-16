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

test('composer preview pane scrolls vertically instead of clipping', async () => {
  const css = await fs.readFile(path.join(root, 'public', 'style.css'), 'utf8');
  const shared = ruleBodies(css, '.composer-editor-pane,\n.composer-preview-pane').join('\n');
  const preview = ruleBodies(css, '.composer-preview-pane').join('\n');
  const inner = ruleBodies(css, '.composer-preview-pane .review-preview').join('\n');

  assert.match(shared, /overflow-y\s*:\s*auto/, 'editor and preview panes share overflow-y:auto');
  assert.doesNotMatch(
    preview,
    /overflow\s*:\s*hidden/,
    'preview pane overflow:hidden clips live preview and eats wheel events',
  );
  assert.match(inner, /flex\s*:\s*1\s+1\s+0/, 'review-preview flex-basis 0 so it can shrink into a scrollport');
  assert.match(inner, /overflow-y\s*:\s*auto/, 'review-preview remains an inner scrollport when height is definite');
});

test('preview media and copy cards clip without becoming wheel traps', async () => {
  const css = await fs.readFile(path.join(root, 'public', 'style.css'), 'utf8');
  const clippers = ruleBodies(css, '.composer-preview-pane .copy-card,\n.composer-preview-pane .preview-image-wrap,\n.composer-preview-pane .media-item').join('\n');

  assert.match(
    clippers,
    /overflow\s*:\s*clip/,
    'overflow:clip clips rounded media/copy without creating a non-scrolling overflow:hidden wheel trap',
  );
});
