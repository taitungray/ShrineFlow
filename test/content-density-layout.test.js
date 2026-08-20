import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadCss } from './fixtures/load-css.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('content list puts posts before CSV import and hides extra filters', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');
  const listAt = html.indexOf('id="postsList"');
  const csvAt = html.indexOf('id="bulkImportCsv"');
  const moreAt = html.indexOf('class="disclosure compact content-more-filters"');
  const stageAt = html.indexOf('id="contentStageFilter"');
  const ideaAt = html.indexOf('id="ideaCaptureForm"');

  assert.ok(listAt > 0 && csvAt > listAt, 'CSV import must sit below the content list');
  assert.ok(moreAt > 0 && stageAt > moreAt, 'stage and platform filters live behind 更多篩選');
  assert.match(html, /class="idea-capture-bar"/, 'Idea capture is a compact bar, not a full card above the list');
  assert.ok(ideaAt > 0 && ideaAt < listAt, 'Idea bar stays above the list without burying it');
  assert.match(html, /class="idea-capture-kicker"/, 'Idea title sits above the two equal fields, not as the topic label');
  assert.match(css, /\.idea-capture-bar\s*\{[^}]*align-items\s*:\s*start/, 'Idea fields top-align; save button sits on the input row');
});

test('content toolbar keeps status pills and trailing actions on one baseline', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');
  const toolbarAt = html.indexOf('class="content-toolbar"');
  const mainAt = html.indexOf('class="content-toolbar-main"');
  const endAt = html.indexOf('class="content-toolbar-end"');

  assert.ok(toolbarAt > 0 && mainAt > toolbarAt && endAt > mainAt, 'status pills and trailing actions share one toolbar-main row');
  assert.match(css, /\.content-toolbar\s*\{[^}]*align-items\s*:\s*center/, 'toolbar centers search, pills, and actions');
  assert.match(css, /\.content-toolbar-end\s*\{[^}]*align-items\s*:\s*center/, 'trailing actions sit on the pill baseline, not flex-end');
  assert.match(css, /\.content-more-filters\.disclosure\.compact\s*\{[^}]*margin\s*:\s*0/, 'more-filters must beat .disclosure.compact margins');
});

test('calendar hides crisis pause and duplicate agenda in month view', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');

  assert.match(html, /<details class="disclosure compact crisis-pause-card" id="crisisPauseCard"/, 'crisis pause starts collapsed');
  assert.match(html, /class="calendar-agenda"/, 'agenda list is wrapped so month/week can hide it');
  assert.match(
    css,
    /data-calendar-view="month"\]:not\(\[data-selected-date\]\) \.calendar-agenda/,
    'month view hides the duplicate agenda until a day is selected',
  );
});

test('nav badges stay hidden until they have a count', async () => {
  const css = await loadCss('public/style.css');
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const overviewJs = await fs.readFile(path.join(root, 'public', 'modules', 'overview.js'), 'utf8');
  const contentNav = html.match(/href="#\/content"[^>]*>[\s\S]*?<\/a>/)?.[0] || '';
  const calendarNav = html.match(/href="#\/calendar"[^>]*>[\s\S]*?<\/a>/)?.[0] || '';

  assert.match(css, /\.nav-badge\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/, 'empty nav badges must not paint a blank circle');
  assert.equal(contentNav.includes('nav-badge'), false, 'content is inventory, not a badge');
  assert.equal(calendarNav.includes('nav-badge'), false, 'calendar is inventory, not a badge');
  assert.match(html, /id="navPublishingBadge" hidden/, 'publishing badge starts hidden');
  assert.match(html, /id="navInboxBadge" hidden/, 'inbox badge starts hidden');
  assert.match(html, /id="navReviewsBadge" hidden/, 'reviews badge starts hidden');
  assert.match(overviewJs, /inboxAttentionCount/, 'inbox badge counts unread or needs-reply only');
});

test('publishing logs reuse content-card density', async () => {
  const js = await fs.readFile(path.join(root, 'public', 'modules', 'publishing-logs.js'), 'utf8');

  assert.match(js, /record-card content-card/, 'publishing logs use the same card shell as content');
  assert.match(js, /record-thumb/, 'thumbnail is visible without opening the post');
  assert.match(js, /excerpt/, 'copy excerpt distinguishes same-title rows');
  assert.match(js, /platformChipHtml/, 'platform chip matches content list');
  assert.match(js, /copyOverride/, 'per-target override copy is preferred over mother copy');
});

test('group titles are room names instead of emoji pills', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await loadCss('public/style.css');
  const titles = [...html.matchAll(/class="group-title">([^<]+)</g)].map((match) => match[1]);

  assert.ok(titles.includes('素材') && titles.includes('母稿') && titles.includes('發去哪裡'));
  assert.equal(titles.filter((title) => /[🚀📸♻️💡📄⛔]/.test(title)).length, 0, 'composer/content group titles drop emoji noise');
  assert.match(css, /\.group-title\s*\{[^}]*background\s*:\s*transparent/, 'group titles are typographic, not sticker pills');
});
