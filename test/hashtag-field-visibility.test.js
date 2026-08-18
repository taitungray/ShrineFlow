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

test('composer and template hashtag fields wrap instead of single-line clipping', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');

  const hashtagsTag = html.match(/<(textarea|input)[^>]*id="hashtagsText"[^>]*>/);
  const templateTag = html.match(/<(textarea|input)[^>]*id="templateHashtags"[^>]*>/);
  assert.ok(hashtagsTag, 'composer hashtag field exists');
  assert.ok(templateTag, 'template hashtag field exists');
  assert.equal(hashtagsTag[1], 'textarea', 'generated tags overflow a single-line input');
  assert.equal(templateTag[1], 'textarea', 'template tags overflow a single-line input');
  assert.doesNotMatch(html, /<input[^>]*id="hashtagsText"/, 'composer hashtags must not stay an input');
  assert.doesNotMatch(html, /<input[^>]*id="templateHashtags"/, 'template hashtags must not stay an input');

  const field = [
    ...ruleBodies(css, '.hashtag-field'),
    ...ruleBodies(css, '#hashtagsText,\n#templateHashtags'),
    ...ruleBodies(css, '#hashtagsText, #templateHashtags'),
  ].join('\n');
  assert.match(field, /overflow-wrap\s*:\s*anywhere/, 'long hashtags must wrap inside the field');
  assert.match(field, /white-space\s*:\s*pre-wrap/, 'hashtag field must show every token, not clip to one line');
  assert.match(field, /min-height\s*:\s*88px/, 'hashtag field needs more than one input row');
});

test('hashtag preview and template cards wrap full tag lists', async () => {
  const css = await loadCss('public/style.css');
  const preview = ruleBodies(css, '.hashtags').join('\n');
  const cards = ruleBodies(css, '.template-hashtags').join('\n');

  assert.match(preview, /overflow-wrap\s*:\s*anywhere/, 'preview hashtags must wrap');
  assert.doesNotMatch(preview, /white-space\s*:\s*nowrap/, 'preview hashtags must not clip');
  assert.match(cards, /overflow-wrap\s*:\s*anywhere/, 'template card hashtags must wrap');
  assert.doesNotMatch(cards, /white-space\s*:\s*nowrap/, 'template card hashtags must not ellipsis-clip');
  assert.doesNotMatch(cards, /text-overflow\s*:\s*ellipsis/, 'template card hashtags must show the full list');
});
