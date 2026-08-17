import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadCss } from './fixtures/load-css.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const VIEW_PANELS = [
  'overview',
  'composer',
  'settings',
  'drafts',
  'reviews',
  'schedule',
  'media',
  'templates',
  'campaigns',
  'publishing',
  'insights',
  'inbox',
  'platforms',
  'team',
  'errors',
  'help',
];

const INNER_TABS = {
  settings: ['gemini', 'brand', 'facebook', 'instagram', 'threads', 'backup'],
  composerModes: ['edit', 'preview'],
  calendar: ['month', 'week', 'list'],
  team: ['members', 'invitations', 'audit'],
};

function extractBraceBlock(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { body: css.slice(openIndex + 1, i), end: i + 1 };
      }
    }
  }
  throw new Error(`Unbalanced CSS brace at ${openIndex}`);
}

function mediaBlocks(css, maxWidthPx) {
  const blocks = [];
  const needle = '@media';
  let searchFrom = 0;
  while (searchFrom < css.length) {
    const at = css.indexOf(needle, searchFrom);
    if (at === -1) break;
    const brace = css.indexOf('{', at);
    if (brace === -1) break;
    const prelude = css.slice(at, brace).replace(/\s+/g, '');
    const { body, end } = extractBraceBlock(css, brace);
    if (prelude.includes(`max-width:${maxWidthPx}px`)) blocks.push(body);
    searchFrom = end;
  }
  return blocks.join('\n');
}

function ruleBodies(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))].map((match) => match[1]);
}

function lastDecls(css, selector) {
  const bodies = ruleBodies(css, selector);
  return bodies.at(-1) || '';
}

test('every workspace view panel and inner tab exists in index.html', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');

  for (const view of VIEW_PANELS) {
    assert.match(
      html,
      new RegExp(`data-view-panel=["']${view}["']`),
      `missing view panel ${view}`,
    );
  }

  for (const page of INNER_TABS.settings) {
    assert.match(html, new RegExp(`data-settings-page="${page}"`), `missing settings tab ${page}`);
  }
  for (const mode of INNER_TABS.composerModes) {
    assert.match(html, new RegExp(`data-composer-mode="${mode}"`), `missing composer mode ${mode}`);
  }
  for (const view of INNER_TABS.calendar) {
    assert.match(html, new RegExp(`name="calendarView" value="${view}"`), `missing calendar view ${view}`);
  }
  for (const section of INNER_TABS.team) {
    assert.match(html, new RegExp(`data-team-section="${section}"`), `missing team tab ${section}`);
  }
});

test('mobile layout drops desktop min-heights that leave empty space', async () => {
  const css = await loadCss('public/style.css');
  const phone = [mediaBlocks(css, 767), mediaBlocks(css, 768)].join('\n');

  assert.match(lastDecls(phone, '.workspace-grid'), /min-height\s*:\s*0/, 'workspace-grid min-height:560px stretches every phone panel');
  assert.match(lastDecls(phone, '.scaffold-panel'), /min-height\s*:\s*0/, 'scaffold-panel keeps 540px empty space on phone');
  assert.match(lastDecls(phone, '.module-panel'), /min-height\s*:\s*0/, 'module-panel keeps 540px empty space on phone');
  assert.match(lastDecls(phone, '.team-section'), /min-height\s*:\s*0/, 'team-section 360px empty block on phone');
  assert.match(lastDecls(phone, '.panel'), /min-height\s*:\s*0/, 'panel anti-jitter 540px must not apply on phone');
});

test('phone CSS does not use 100vw and does not lock composer to 100dvh', async () => {
  const css = await loadCss('public/style.css');
  const phone = mediaBlocks(css, 767);
  const htmlDecls = [...ruleBodies(css, 'html'), ...ruleBodies(phone, 'html')].join('\n');
  const bodyDecls = [...ruleBodies(css, 'body'), ...ruleBodies(phone, 'body')].join('\n');

  assert.doesNotMatch(htmlDecls, /100vw/, 'html max-width:100vw overflows past the visual viewport');
  assert.doesNotMatch(bodyDecls, /100vw/, 'body max-width:100vw overflows past the visual viewport');

  const composerBody = lastDecls(phone, 'body:has(#composerPanel:not(.is-hidden))');
  assert.match(composerBody, /height\s*:\s*auto/, 'composer 100dvh lock clips the form and leaves empty chrome on phone');
  assert.match(composerBody, /overflow(?:-y)?\s*:\s*(auto|visible)/, 'composer overflow:hidden on html/body eats the phone page scroll');
  assert.match(lastDecls(phone, '.composer-workspace'), /overflow\s*:\s*visible/, 'composer-workspace overflow:hidden clips editor fields on phone');
});

test('phone chrome uses the header and does not double-pad the bottom nav', async () => {
  const css = await loadCss('public/style.css');
  const phone = mediaBlocks(css, 767);
  const heading = lastDecls(phone, '.page-heading');
  const shell = lastDecls(phone, '.shell');
  const leading = lastDecls(phone, '.topbar-leading');

  assert.doesNotMatch(heading, /display\s*:\s*none/, 'hiding the page title leaves a blank flex hole beside the menu button');
  assert.match(leading, /flex\s*:\s*1/, 'page title must consume the leftover header space');
  assert.doesNotMatch(shell, /safe-area-inset-bottom/, 'shell + body both adding safe-area leaves a dead band above the bottom nav');
});

test('phone viewports do not overflow any panel or inner tab', async () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'audit-mobile-layout.mjs'), '--phone'], {
    cwd: root,
    encoding: 'utf8',
  });
  if ((result.stdout || '').includes('SKIP:')) return;
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /failCount=0/, 'a phone viewport still has a panel or tab overflowing');
});

test('desktop CSS keeps sidebar shell, anti-jitter panels, and dual-pane composer', async () => {
  const css = await loadCss('public/style.css');
  const phone = mediaBlocks(css, 767);
  const desktopPanel = ruleBodies(css, '.panel').find((body) => /min-height\s*:\s*540px/.test(body)) || '';
  const composerLock = ruleBodies(css, 'body:has(#composerPanel:not(.is-hidden))')[0] || '';
  const shell = ruleBodies(css, '.shell')[0] || '';
  const sidebar = ruleBodies(css, '.app-sidebar')[0] || '';
  const workspace = ruleBodies(css, '.workspace-grid').join('\n');

  assert.match(desktopPanel, /min-height\s*:\s*540px/, 'desktop panels must keep anti-jitter min-height');
  assert.doesNotMatch(phone, /\.panel\s*\{[^}]*min-height\s*:\s*540px/, 'phone must not inherit 540px panel lock');
  assert.match(composerLock, /height\s*:\s*100dvh/, 'desktop composer keeps the dual-pane height lock');
  assert.match(shell, /margin-left:\s*248px|margin:\s*0\s+0\s+60px\s+248px/, 'desktop shell sits beside the 248px sidebar');
  assert.match(sidebar, /width:\s*248px/, 'desktop sidebar stays a fixed 248px column');
  assert.match(workspace, /min-height\s*:\s*560px/, 'desktop workspace keeps anti-jitter min-height');
  assert.match(css, /grid-template-columns\s*:\s*minmax\(\s*0\s*,\s*1\.05fr\s*\)\s+minmax\(\s*360px\s*,\s*0\.95fr\s*\)/, 'desktop composer is editor + preview, not a single squeezed column');
});

test('web viewports do not overflow any panel or inner tab', async () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'audit-mobile-layout.mjs'), '--web'], {
    cwd: root,
    encoding: 'utf8',
  });
  if ((result.stdout || '').includes('SKIP:')) return;
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /failCount=0/, 'a web viewport still has a panel or tab overflowing');
  assert.match(result.stdout, /desktop-1100/, 'min desktop width must be audited');
  assert.match(result.stdout, /laptop-1280/, 'laptop width must be audited');
});
