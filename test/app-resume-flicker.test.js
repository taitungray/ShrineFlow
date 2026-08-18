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

test('visible panels do not fade in on every paint so PWA resume cannot replay opacity 0', async () => {
  const css = await loadCss('public/style.css');
  const visiblePanel = ruleBodies(css, '.panel:not(.is-hidden)').join('\n');

  assert.equal(visiblePanel, '', 'a persistent :not(.is-hidden) animation restarts when iOS/Android app mode returns from background');
  assert.doesNotMatch(
    css,
    /\.panel:not\(\.is-hidden\)\s*\{[^}]*\banimation\b/,
    'panel fade tied to visibility is the full-screen flash on resume and back',
  );
});

test('document scroll is instant so view restore does not animate a second flash', async () => {
  const css = await loadCss('public/style.css');
  const html = ruleBodies(css, 'html').join('\n');

  assert.match(html, /scroll-behavior\s*:\s*auto/, 'smooth document scroll turns resetViewScroll into a visible jump');
  assert.doesNotMatch(html, /scroll-behavior\s*:\s*smooth/, 'smooth scroll on html flashes when hashchange and popstate both reset');
});

test('installed app chrome matches the page background', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');

  assert.match(html, /name="theme-color"[^>]*content="#141211"/, 'dark standalone toolbar must not flash white');
  assert.match(html, /name="theme-color"[^>]*content="#f7f1eb"/, 'light standalone toolbar must match --bg-app');
  assert.match(html, /apple-mobile-web-app-status-bar-style/, 'iOS home-screen status bar needs an explicit dark style');
});
