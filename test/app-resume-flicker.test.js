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

test('first paint keeps the app background so PWA reload cannot flash white then login', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');
  const htmlRule = ruleBodies(css, 'html').join('\n');

  assert.match(html, /background-color:\s*#f7f1eb/, 'inline boot color must match light --bg-app before CSS arrives');
  assert.match(html, /background-color:\s*#141211/, 'inline boot color must match dark --bg-app before CSS arrives');
  assert.match(htmlRule, /background-color\s*:\s*var\(--bg-app\)/, 'html itself must paint the app color, not a transparent white flash');
});

test('signed-in return skips the auth gate before first paint', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const authJs = await fs.readFile(path.join(root, 'public', 'modules', 'auth.js'), 'utf8');
  const bootJs = await fs.readFile(path.join(root, 'public', 'modules', 'boot-stability.js'), 'utf8');

  assert.match(html, /shrineflow\.signedIn/, 'HttpOnly session cookie cannot be read; first paint needs a local signed-in hint');
  assert.match(html, /has-session/, 'signed-in hint must hide the gate before #authGate is parsed');
  assert.match(html, /html\.has-session #authGate/, 'returning users must not see the login card on PWA reload');
  assert.match(html, /classList\.remove\(['"]auth-required['"]\)/, 'returning users must not see the login card on PWA reload');
  assert.match(bootJs, /export function rememberSignedIn/, 'auth and login reloads share one signed-in hint helper');
  assert.match(authJs, /rememberSignedIn\(/, 'successful auth and logout must keep the first-paint hint in sync');
});

test('theme and motion stay locked across PWA resume so iOS cannot replay a light/dark flash', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');
  const appJs = await fs.readFile(path.join(root, 'public', 'app.js'), 'utf8');

  assert.match(html, /dataset\.theme/, 'theme must be pinned on html before first paint');
  assert.match(html, /is-booting/, 'boot class suppresses entrance motion until auth finishes');
  assert.match(
    css,
    /html\.(?:is-booting|is-resuming)[^{]*\{[^}]*transition\s*:\s*none\s*!important/,
    'resume must freeze transitions; iOS replays transition:all as a full-page flash',
  );
  assert.match(
    css,
    /html\[data-theme=["']dark["']\][^{]*\{[^}]*--bg-app\s*:\s*#141211/,
    'dark tokens must follow the pinned theme, not a flickering prefers-color-scheme',
  );
  assert.match(
    css,
    /@media\s*\(hover:\s*none\)[\s\S]*\.panel[\s\S]*backdrop-filter\s*:\s*none/,
    'phone GPU backdrop-filter on full-screen panels flashes on resume',
  );
  assert.match(appJs, /initResumeStability/, 'visibility resume must freeze motion after iOS restores the page');
});
