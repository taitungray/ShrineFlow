import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIST_PAGE_SIZE,
  GRID_PAGE_SIZE,
  paginate,
  pageWindow,
  renderPagerHtml,
} from '../public/modules/pagination.js';

test('paginate slices a long list and reports range', () => {
  const items = Array.from({ length: 45 }, (_, index) => index + 1);
  const first = paginate(items, { page: 1, pageSize: 20 });
  assert.deepEqual(first.items, items.slice(0, 20));
  assert.equal(first.page, 1);
  assert.equal(first.total, 45);
  assert.equal(first.totalPages, 3);
  assert.equal(first.start, 1);
  assert.equal(first.end, 20);
  assert.equal(first.hasPrev, false);
  assert.equal(first.hasNext, true);

  const last = paginate(items, { page: 3, pageSize: 20 });
  assert.deepEqual(last.items, [41, 42, 43, 44, 45]);
  assert.equal(last.start, 41);
  assert.equal(last.end, 45);
  assert.equal(last.hasPrev, true);
  assert.equal(last.hasNext, false);
});

test('paginate clamps out-of-range pages', () => {
  const items = Array.from({ length: 12 }, (_, index) => index);
  assert.equal(paginate(items, { page: 0, pageSize: 5 }).page, 1);
  assert.equal(paginate(items, { page: 99, pageSize: 5 }).page, 3);
  assert.equal(paginate(items, { page: 'nope', pageSize: 5 }).page, 1);
});

test('paginate keeps an empty list on page 1', () => {
  const empty = paginate([], { page: 4, pageSize: 20 });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.page, 1);
  assert.equal(empty.total, 0);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.start, 0);
  assert.equal(empty.end, 0);
  assert.equal(empty.hasPrev, false);
  assert.equal(empty.hasNext, false);
});

test('pageWindow shows nearby pages and ellipsis for long ranges', () => {
  assert.deepEqual(pageWindow(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(1, 20), [1, 2, 3, 'ellipsis', 20]);
  assert.deepEqual(pageWindow(10, 20), [1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]);
  assert.deepEqual(pageWindow(20, 20), [1, 'ellipsis', 18, 19, 20]);
});

test('renderPagerHtml stays empty when one page is enough', () => {
  const html = renderPagerHtml(paginate([1, 2], { page: 1, pageSize: 20 }));
  assert.equal(html, '');
});

test('renderPagerHtml exposes prev next and current page', () => {
  const items = Array.from({ length: 45 }, (_, index) => index);
  const html = renderPagerHtml(paginate(items, { page: 2, pageSize: 20 }), { label: '內容分頁' });
  assert.match(html, /第 21–40 筆，共 45 筆/);
  assert.match(html, /aria-label="內容分頁"/);
  assert.match(html, /data-pager-page="1"/);
  assert.match(html, /data-pager-page="2"[^>]*aria-current="page"/);
  assert.match(html, /data-pager-page="3"/);
  assert.match(html, /上一頁/);
  assert.match(html, /下一頁/);
  assert.doesNotMatch(html, /disabled[^>]*data-pager-page="1"/);
});

test('page size constants stay compact for cards and grids', () => {
  assert.equal(LIST_PAGE_SIZE, 20);
  assert.equal(GRID_PAGE_SIZE, 12);
});
