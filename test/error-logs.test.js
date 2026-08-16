import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFromHash } from '../public/modules/tabs.js';
import {
  canViewErrorLogs,
  errorLogStatusLabel,
  renderErrorLogListHtml,
} from '../public/modules/error-logs.js';
import { HELP_ARTICLES } from '../public/modules/help-articles.js';

test('errors hash opens the dedicated error log view', () => {
  assert.deepEqual(routeFromHash('#/errors'), { view: 'errors', path: 'errors' });
});

test('settings hash still opens settings', () => {
  assert.deepEqual(routeFromHash('#/settings'), { view: 'settings', path: 'settings' });
});

test('unknown hash falls back to overview', () => {
  assert.deepEqual(routeFromHash('#/not-a-page'), { view: 'overview', path: 'overview' });
});

test('only system.manage can view error logs', () => {
  assert.equal(canViewErrorLogs((permission) => permission === 'system.manage'), true);
  assert.equal(canViewErrorLogs((permission) => permission === 'audit.view'), false);
  assert.equal(canViewErrorLogs((permission) => permission === 'account.manage'), false);
  assert.equal(canViewErrorLogs(() => false), false);
});

test('error log status labels stay in Traditional Chinese', () => {
  assert.equal(errorLogStatusLabel('fixed'), '已修正');
  assert.equal(errorLogStatusLabel('open'), '未修正');
  assert.equal(errorLogStatusLabel(''), '未修正');
});

test('denied viewers get a permission empty state and no error payload', () => {
  const html = renderErrorLogListHtml([
    { id: 'err-1', scope: 'http', status: 502, message: 'secret <token>', resolutionStatus: 'open' },
  ], { allowed: false });
  assert.match(html, /你沒有查看錯誤記錄的權限/);
  assert.equal(html.includes('secret'), false);
  assert.equal(html.includes('err-1'), false);
});

test('allowed list renders escaped error details and a resolve action', () => {
  const html = renderErrorLogListHtml([
    {
      id: 'err-1',
      scope: 'schedule_facebook',
      status: 400,
      message: 'Unsupported <script>',
      resolutionStatus: 'open',
      count: 2,
      lastSeenAt: '2026-08-16T03:43:00.000Z',
    },
  ], { allowed: true, formatDate: () => '2026年8月16日' });
  assert.match(html, /schedule_facebook/);
  assert.match(html, /未修正/);
  assert.match(html, /2 次/);
  assert.match(html, /data-resolve-error="err-1"/);
  assert.match(html, /Unsupported &lt;script&gt;/);
  assert.equal(html.includes('<script>'), false);
});

test('error-log help article points to the dedicated errors page', () => {
  const article = HELP_ARTICLES.find((item) => item.id === 'error-log');
  assert.ok(article);
  assert.ok(article.related.some((link) => link.href === '#/errors'));
  assert.ok(article.steps.some((step) => step.includes('錯誤記錄') && !step.includes('備份與儲存')));
});
