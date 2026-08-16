import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('content list puts posts before CSV import and hides extra filters', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const listAt = html.indexOf('id="postsList"');
  const csvAt = html.indexOf('id="bulkImportCsv"');
  const moreAt = html.indexOf('class="disclosure compact content-more-filters"');
  const stageAt = html.indexOf('id="contentStageFilter"');
  const ideaAt = html.indexOf('id="ideaCaptureForm"');

  assert.ok(listAt > 0 && csvAt > listAt, 'CSV import must sit below the content list');
  assert.ok(moreAt > 0 && stageAt > moreAt, 'stage and platform filters live behind 更多篩選');
  assert.match(html, /class="idea-capture-bar"/, 'Idea capture is a compact bar, not a full card above the list');
  assert.ok(ideaAt > 0 && ideaAt < listAt, 'Idea bar stays above the list without burying it');
});

test('calendar hides crisis pause and duplicate agenda in month view', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public', 'style.css'), 'utf8');

  assert.match(html, /<details class="disclosure compact crisis-pause-card" id="crisisPauseCard"/, 'crisis pause starts collapsed');
  assert.match(html, /class="calendar-agenda"/, 'agenda list is wrapped so month/week can hide it');
  assert.match(css, /data-calendar-view="month"\] \.calendar-agenda/, 'month view hides the duplicate agenda list');
});

test('group titles are room names instead of emoji pills', async () => {
  const html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const css = await fs.readFile(path.join(root, 'public', 'style.css'), 'utf8');
  const titles = [...html.matchAll(/class="group-title">([^<]+)</g)].map((match) => match[1]);

  assert.ok(titles.includes('素材') && titles.includes('母稿') && titles.includes('發去哪裡'));
  assert.equal(titles.filter((title) => /[🚀📸♻️💡📄⛔]/.test(title)).length, 0, 'composer/content group titles drop emoji noise');
  assert.match(css, /\.group-title\s*\{[^}]*background\s*:\s*transparent/, 'group titles are typographic, not sticker pills');
});
