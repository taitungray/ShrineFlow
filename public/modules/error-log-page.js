import { $, showToast } from './dom.js';
import { api } from './api.js';
import { hasPermission } from './state.js';
import { routeFromHash } from './tabs.js';
import { canViewErrorLogs, renderErrorLogListHtml } from './error-logs.js';

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
    if (list) list.innerHTML = renderErrorLogListHtml([], { allowed: false });
    return;
  }
  const status = errorLogStatusFilter();
  const entries = await api('/api/system/error-log?limit=50&status=' + encodeURIComponent(status));
  if (result) result.textContent = entries.length ? `最近有 ${entries.length} 筆錯誤記錄。` : '目前沒有符合篩選的錯誤記錄。';
  if (list) list.innerHTML = renderErrorLogListHtml(entries, { allowed: true });
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

