import { escapeHtml } from './dom.js';

export const LIST_PAGE_SIZE = 20;
export const GRID_PAGE_SIZE = 12;
export const PICKER_PAGE_SIZE = 18;

export function paginate(items = [], { page = 1, pageSize = LIST_PAGE_SIZE } = {}) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(Number(pageSize) || LIST_PAGE_SIZE));
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const requested = Math.floor(Number(page));
  const safePage = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), totalPages) : 1;
  const startIndex = (safePage - 1) * size;
  const pageItems = list.slice(startIndex, startIndex + size);
  return {
    items: pageItems,
    page: safePage,
    pageSize: size,
    total,
    totalPages,
    start: total ? startIndex + 1 : 0,
    end: total ? startIndex + pageItems.length : 0,
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
  };
}

export function pageWindow(page, totalPages, radius = 1) {
  const last = Math.max(1, Math.floor(Number(totalPages) || 1));
  const current = Math.min(Math.max(Math.floor(Number(page) || 1), 1), last);
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);

  const pages = new Set([1, last]);
  for (let index = current - radius; index <= current + radius; index += 1) {
    if (index >= 1 && index <= last) pages.add(index);
  }
  if (current <= 1 + radius) {
    pages.add(2);
    pages.add(3);
  }
  if (current >= last - radius) {
    pages.add(last - 1);
    pages.add(last - 2);
  }

  const sorted = [...pages].filter((value) => value >= 1 && value <= last).sort((a, b) => a - b);
  const windowItems = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) windowItems.push('ellipsis');
    windowItems.push(value);
  });
  return windowItems;
}

export function renderPagerHtml(pageInfo, { label = '分頁' } = {}) {
  if (!pageInfo || pageInfo.total <= pageInfo.pageSize || pageInfo.totalPages <= 1) return '';
  const pages = pageWindow(pageInfo.page, pageInfo.totalPages)
    .map((item) => {
      if (item === 'ellipsis') return '<span class="list-pager-ellipsis" aria-hidden="true">…</span>';
      const current = item === pageInfo.page;
      return '<button type="button" class="list-pager-page' + (current ? ' is-active' : '') + '" data-pager-page="'
        + item + '"' + (current ? ' aria-current="page"' : '') + ' aria-label="第 ' + item + ' 頁">' + item + '</button>';
    })
    .join('');
  const prevPage = Math.max(1, pageInfo.page - 1);
  const nextPage = Math.min(pageInfo.totalPages, pageInfo.page + 1);
  return '<div class="list-pager-bar" role="navigation" aria-label="' + escapeHtml(label) + '">'
    + '<p class="list-pager-meta">第 ' + pageInfo.start + '–' + pageInfo.end + ' 筆，共 ' + pageInfo.total + ' 筆</p>'
    + '<div class="list-pager-controls">'
    + '<button type="button" class="list-pager-nav" data-pager-page="' + prevPage + '"'
    + (pageInfo.hasPrev ? '' : ' disabled') + '>上一頁</button>'
    + '<span class="list-pager-pages">' + pages + '</span>'
    + '<button type="button" class="list-pager-nav" data-pager-page="' + nextPage + '"'
    + (pageInfo.hasNext ? '' : ' disabled') + '>下一頁</button>'
    + '</div></div>';
}

export function removeListPager(anchorEl) {
  const existing = anchorEl?.nextElementSibling;
  if (existing?.dataset.listPager === 'true') existing.remove();
}

export function syncListPager(anchorEl, pageInfo, { label = '分頁', onPage } = {}) {
  if (!anchorEl) return;
  removeListPager(anchorEl);
  const html = renderPagerHtml(pageInfo, { label });
  if (!html) return;
  const nav = document.createElement('nav');
  nav.className = 'list-pager';
  nav.dataset.listPager = 'true';
  nav.innerHTML = html;
  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pager-page]');
    if (!button || button.disabled) return;
    const next = Number(button.dataset.pagerPage);
    if (!Number.isInteger(next) || next === pageInfo.page) return;
    onPage?.(next);
    anchorEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  anchorEl.after(nav);
}
