import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP_ARTICLES } from '../public/modules/help-articles.js';
import { filterHelpArticles } from '../public/modules/help-search.js';
import { renderHelpStepsHtml } from '../public/modules/help.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const REQUIRED_IDS = [
  'getting-started',
  'what-is-brand',
  'nav-map',
  'login-expired',
  'composer-basics',
  'ai-generate',
  'ai-rewrite',
  'gemini-key-invalid',
  'hashtags-and-comment',
  'autosave-conflict',
  'media-upload',
  'media-file-too-large',
  'media-mixed',
  'media-format-limits',
  'public-media-url',
  'media-library',
  'facebook-connect',
  'facebook-app-live',
  'facebook-user-id',
  'facebook-token-expired',
  'facebook-permissions',
  'facebook-cannot-parse-token',
  'facebook-accounts-empty',
  'facebook-story-no-schedule',
  'facebook-schedule-window',
  'facebook-remote-schedule',
  'content-hide',
  'facebook-duplicate-posts',
  'instagram-connect',
  'instagram-not-linked',
  'instagram-schedule-local',
  'threads-connect',
  'threads-schedule-local',
  'schedule-how',
  'schedule-already',
  'queue-how',
  'calendar-dst',
  'evergreen-how',
  'crisis-pause',
  'idea-cannot-schedule',
  'archived-cannot-schedule',
  'publish-now',
  'publish-failed',
  'partial-success',
  'content-type-unsupported',
  'approval-required',
  'content-statuses',
  'duplicate-and-repurpose',
  'bulk-csv',
  'review-queue',
  'roles-permissions',
  'member-invite',
  'inbox-how',
  'templates-campaigns',
  'platforms-page',
  'settings-save-order',
  'backup-restore',
  'master-key',
  'error-log',
  'cannot-do',
  'ig-offline',
  'line-removed',
];

test('help catalog includes every spec article with complete fields', () => {
  const byId = new Map(HELP_ARTICLES.map((article) => [article.id, article]));
  const missing = REQUIRED_IDS.filter((id) => !byId.has(id));
  assert.deepEqual(missing, []);
  assert.equal(new Set(HELP_ARTICLES.map((article) => article.id)).size, HELP_ARTICLES.length);

  for (const id of REQUIRED_IDS) {
    const article = byId.get(id);
    assert.ok(['guide', 'troubleshoot', 'limit'].includes(article.kind), id);
    assert.ok(Array.isArray(article.topics) && article.topics.length > 0, id);
    assert.ok(String(article.title || '').trim(), id);
    assert.ok(String(article.summary || '').trim(), id);
    assert.ok(Array.isArray(article.keywords) && article.keywords.length > 0, id);
    assert.ok(String(article.symptoms || '').trim(), id);
    assert.ok(String(article.cause || '').trim(), id);
    assert.ok(Array.isArray(article.steps) && article.steps.length > 0, id);
    assert.ok(Array.isArray(article.related) && article.related.length > 0, id);
    assert.ok(article.related.every((link) => link.label && String(link.href || '').startsWith('#/')), id);
  }
});

test('real catalog still matches pasted Graph object-access errors', () => {
  const results = filterHelpArticles(
    HELP_ARTICLES,
    "Unsupported post request. Object with ID '1701654120897096' does not exist, cannot be loaded due to missing permissions",
  );
  assert.equal(results.some((article) => article.id === 'facebook-user-id'), true);
});

test('facebook connect article keeps a short summary and longer advanced steps', () => {
  const article = HELP_ARTICLES.find((item) => item.id === 'facebook-connect');
  assert.ok(article.steps.length <= 6);
  assert.ok(Array.isArray(article.advancedSteps) && article.advancedSteps.length >= 6);
});

test('every help article keeps quoted terms inside the step copy column', async () => {
  let quotedSteps = 0;
  for (const article of HELP_ARTICLES) {
    const chunks = [...(article.steps || []), ...(article.advancedSteps || [])];
    const html = renderHelpStepsHtml(chunks);
    if (!html) continue;
    const items = html.match(/<li>/g) || [];
    const wrapped = html.match(/<li><span class="help-step-copy">/g) || [];
    assert.equal(wrapped.length, items.length, article.id + ' has an unwrapped step');
    assert.equal(html.includes('<li><strong class="help-term">'), false, article.id + ' leaked a term into the number column');
    quotedSteps += (html.match(/<strong class="help-term">/g) || []).length;
  }
  assert.ok(quotedSteps > 0, 'catalog still has quoted UI terms to protect');
  const css = await fs.readFile(path.join(root, 'public', 'css', 'layout.css'), 'utf8');
  assert.match(css, /\.help-steps\s*>\s*li\s*>\s*\*\s*\{[^}]*grid-column\s*:\s*2/, 'any leftover child must stay in the copy column');
});

test('facebook live article matches the not-visible-to-others symptom', () => {
  const results = filterHelpArticles(HELP_ARTICLES, '自己看得到 別人看不到 Development');
  assert.equal(results.some((article) => article.id === 'facebook-app-live'), true);
  const article = HELP_ARTICLES.find((item) => item.id === 'facebook-app-live');
  assert.match(article.steps.join('\n'), /privacy\.html/);
  assert.match(article.steps.join('\n'), /切成 Live/);
});
