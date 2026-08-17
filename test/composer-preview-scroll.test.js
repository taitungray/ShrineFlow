import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadCss } from './fixtures/load-css.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function ruleBodies(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))].map((match) => match[1]);
}

test('composer preview pane scrolls vertically instead of clipping', async () => {
  const css = await loadCss('public/style.css');
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

test('composer live preview shows full-width media instead of 140px thumbs', async () => {
  const css = await loadCss('public/style.css');
  const gallery = ruleBodies(css, '.preview-media-gallery').join('\n');
  const media = ruleBodies(css, '.preview-media-gallery .media-item img,\n.preview-media-gallery .media-item video').join('\n');

  assert.doesNotMatch(gallery, /repeat\(\s*2/, 'live preview must not force a 2-column thumbnail grid');
  assert.match(
    gallery,
    /grid-template-columns\s*:\s*minmax\(\s*0\s*,\s*1fr\s*\)/,
    'live preview stacks media in one column so each image can use the pane width',
  );
  assert.doesNotMatch(media, /max-height\s*:\s*140px/, '140px cap shrinks statue photos into unreadable thumbs');
  assert.match(media, /width\s*:\s*100%/, 'preview media fills the pane width');
  assert.match(media, /max-height\s*:\s*none/, 'preview media keeps native aspect instead of a fixed cap');
  assert.match(media, /object-fit\s*:\s*contain/, 'preview media must show the whole frame');
});

test('preview media and copy cards clip without becoming wheel traps', async () => {
  const css = await loadCss('public/style.css');
  const clippers = ruleBodies(css, '.composer-preview-pane .copy-card,\n.composer-preview-pane .preview-image-wrap,\n.composer-preview-pane .media-item').join('\n');

  assert.match(
    clippers,
    /overflow\s*:\s*clip/,
    'overflow:clip clips rounded media/copy without creating a non-scrolling overflow:hidden wheel trap',
  );
});

test('live preview drops the empty media placeholder so photos can use the pane', async () => {
  const css = await loadCss('public/style.css');
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const wrap = ruleBodies(css, '.preview-image-wrap').join('\n');
  const hiddenEmpty = [
    ...ruleBodies(css, '.preview-image-wrap:not(:has(.media-item)),\n.preview-image-wrap.empty'),
    ...ruleBodies(css, '.preview-image-wrap:not(:has(.media-item)), .preview-image-wrap.empty'),
  ].join('\n');
  const hasMedia = ruleBodies(css, '.preview-image-wrap:has(.media-item)').join('\n');

  assert.doesNotMatch(html, /媒體預覽/, 'placeholder label steals space above real photos');
  assert.doesNotMatch(html, /preview-empty/, 'empty-state chrome is gone; gallery is the preview');
  assert.match(html, /id="previewImageWrap"[^>]*\bhidden\b/, 'wrap starts hidden until media exists');
  assert.doesNotMatch(wrap, /min-height\s*:\s*180px/, '180px empty box reserved height even when photos exist');
  assert.match(hiddenEmpty, /display\s*:\s*none/, 'no media → hide the whole wrap, do not keep a dashed slot');
  assert.match(hasMedia, /display\s*:\s*grid/, 'stuck .empty class must not hide photos once .media-item exists');
});
