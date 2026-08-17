import { $, showToast } from './dom.js';
import { api } from './api.js';
import { hasPermission } from './state.js';
import { routeFromHash } from './tabs.js';
import { canViewErrorLogs, renderErrorLogListHtml } from './error-logs.js';
import { LIST_PAGE_SIZE, paginate, removeListPager, syncListPager } from './pagination.js';

let errorPage = 1;
let cachedErrorEntries = [];

function errorLogStatusFilter() {
  return document.querySelector('input[name="errorLogStatusFilter"]:checked')?.value || 'open';
}

function setMessage(message, type = '') {
  const element = $('#errorLogMessage');
  if (!element) return;
  element.textContent = message;
  element.className = 'test-result ' + (type ? 'text-' + type : '');
}

async function refreshErrorLog() {
  const result = $('#errorLogResult');
  const list = $('#errorLogList');
  if (!canViewErrorLogs(hasPermission)) {
    if (result) result.textContent = '';
    if (list) {
      removeListPager(list);
      list.innerHTML = renderErrorLogListHtml([], { allowed: false });
    }
    return;
  }
  const status = errorLogStatusFilter();
  cachedErrorEntries = await api('/api/system/error-log?limit=500&status=' + encodeURIComponent(status));
  errorPage = 1;
  if (result) result.textContent = cachedErrorEntries.length ? `最近有 ${cachedErrorEntries.length} 筆錯誤記錄。` : '目前沒有符合篩選的錯誤記錄。';
  renderErrorLogEntries(list);
}

function renderErrorLogEntries(list = $('#errorLogList')) {
  if (!list) return;
  if (!cachedErrorEntries.length) {
    removeListPager(list);
    list.innerHTML = renderErrorLogListHtml([], { allowed: true });
    return;
  }
  const paged = paginate(cachedErrorEntries, { page: errorPage, pageSize: LIST_PAGE_SIZE });
  errorPage = paged.page;
  list.innerHTML = renderErrorLogListHtml(paged.items, {
    allowed: true,
    countLabel: '共 ' + paged.total + ' 筆',
  });
  syncListPager(list, paged, {
    label: '錯誤記錄分頁',
    onPage: (page) => {
      errorPage = page;
      renderErrorLogEntries(list);
    },
  });
}

async function downloadErrorLog() {
  const payload = await api('/api/system/error-log/export?status=all');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = String(payload.exportedAt || new Date().toISOString()).slice(0, 10);
  link.href = url;
  link.download = 'shrineflow-error-log-' + stamp + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function maybeRefreshErrorLog() {
  if (routeFromHash().view !== 'errors') return;
  refreshErrorLog().catch((error) => setMessage(error.message, 'danger'));
}

export function initErrorLogs() {
  $('#btnRefreshErrorLog')?.addEventListener('click', async () => {
    try {
      await refreshErrorLog();
      setMessage('錯誤記錄已更新。', 'success');
    } catch (error) {
      setMessage(error.message, 'danger');
    }
  });

  $('#btnExportErrorLog')?.addEventListener('click', async () => {
    try {
      await downloadErrorLog();
      setMessage('錯誤記錄已下載。', 'success');
      showToast('錯誤記錄已下載', 'success');
    } catch (error) {
      setMessage(error.message, 'danger');
    }
  });

  document.querySelectorAll('input[name="errorLogStatusFilter"]').forEach((input) => {
    input.addEventListener('change', () => {
      refreshErrorLog().catch((error) => setMessage(error.message, 'danger'));
    });
  });

  $('#errorLogList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-resolve-error]');
    if (!button) return;
    try {
      button.disabled = true;
      await api('/api/system/error-log/' + encodeURIComponent(button.dataset.resolveError) + '/resolve', {
        method: 'POST',
      });
      await refreshErrorLog();
      setMessage('已標為修正。', 'success');
    } catch (error) {
      button.disabled = false;
      setMessage(error.message, 'danger');
    }
  });

  document.querySelectorAll('[data-view-target="errors"]').forEach((item) => {
    item.addEventListener('click', () => maybeRefreshErrorLog());
  });
  window.addEventListener('hashchange', maybeRefreshErrorLog);
  window.addEventListener('popstate', maybeRefreshErrorLog);

  refreshErrorLog().catch(() => {});
}

