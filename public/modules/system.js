import { $, escapeHtml, formatDate, showToast } from './dom.js';
import { api } from './api.js';

function includeMedia() {
  return Boolean($('#backupIncludeMedia')?.checked);
}

function setMessage(message, type = '') {
  const element = $('#systemStorageMessage');
  if (!element) return;
  element.textContent = message;
  element.className = 'test-result ' + (type ? 'text-' + type : '');
}

function renderBackups(backups = []) {
  const list = $('#backupList');
  if (!list) return;
  if (!backups.length) {
    list.innerHTML = '<p class="helper">尚未建立備份。</p>';
    return;
  }
  list.innerHTML = '<div class="backup-list-heading"><strong>可還原備份</strong><span>' + backups.length + ' 份</span></div>' + backups.map((backup) => (
    '<div class="backup-row"><div><strong>' + escapeHtml(backup.id) + '</strong><small>' + escapeHtml(formatDate(backup.createdAt)) + ' · ' + (backup.includesMedia ? '含素材' : '僅資料') + '</small></div><button type="button" class="btn-text" data-restore-backup="' + escapeHtml(backup.id) + '">還原</button></div>'
  )).join('');
}

async function refreshBackups() {
  renderBackups(await api('/api/system/backups'));
}

async function refreshStorageHealth() {
  const health = await api('/api/system/storage-health');
  const result = $('#storageHealthResult');
  if (result) {
    result.textContent = '素材 ' + health.uploads.fileCount + ' 檔，未使用 ' + health.uploads.orphanFileCount + ' 檔（' + health.uploads.orphanBytes + ' bytes）。';
  }
  return health;
}

function errorLogStatusFilter() {
  return document.querySelector('input[name="errorLogStatusFilter"]:checked')?.value || 'open';
}

function errorLogStatusLabel(status) {
  return status === 'fixed' ? '已修正' : '未修正';
}

async function refreshErrorLog() {
  const status = errorLogStatusFilter();
  const entries = await api('/api/system/error-log?limit=50&status=' + encodeURIComponent(status));
  const result = $('#errorLogResult');
  const list = $('#errorLogList');
  if (result) result.textContent = entries.length ? `最近有 ${entries.length} 筆錯誤記錄。` : '目前沒有符合篩選的錯誤記錄。';
  if (!list) return;
  list.innerHTML = entries.length
    ? '<div class="backup-list-heading"><strong>錯誤記錄</strong><span>最多顯示 50 筆</span></div>' + entries.map((entry) => {
      const count = Number(entry.count || 1);
      const resolved = entry.resolutionStatus === 'fixed';
      const action = resolved
        ? ''
        : '<button type="button" class="btn-text" data-resolve-error="' + escapeHtml(entry.id) + '">標已修正</button>';
      return '<div class="backup-row"><div><strong>' + escapeHtml(entry.scope || 'unknown')
        + ' · ' + escapeHtml(String(entry.status || entry.code || ''))
        + ' · ' + escapeHtml(errorLogStatusLabel(entry.resolutionStatus))
        + '</strong><small>' + escapeHtml(formatDate(entry.lastSeenAt || entry.createdAt))
        + ' · ' + count + ' 次 · ' + escapeHtml(entry.message || '')
        + '</small></div>' + action + '</div>';
    }).join('')
    : '';
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

async function refreshSystemHealth() {
  const health = await api('/api/system/health');
  const result = $('#systemHealthResult');
  if (!result) return health;
  const files = health.storage?.jsonFiles || {};
  const backups = health.storage?.backups?.count || 0;
  const postUsage = files.details?.posts;
  const contentUsage = postUsage?.maxItems
    ? ` · 內容 ${postUsage.itemCount || 0}/${postUsage.maxItems}`
    : '';
  const hasUsageWarning = Object.values(files.details || {}).some((item) => item.usage?.status === 'warning')
    || health.storage?.uploads?.usage?.status === 'warning';
  const status = health.status !== 'ok' ? '需要注意' : (hasUsageWarning ? '接近上限' : '正常');
  const usageNotice = hasUsageWarning ? ' · 配額已達 80% 請先整理或封存' : '';
  result.textContent = `${status} · JSON ${files.healthy || 0}/${files.total || 0}${contentUsage}${usageNotice} · 備份 ${backups} 份 · 排程器 ${health.scheduler?.running ? '運作中' : '待命'}`;
  result.className = 'helper ' + (status === '正常' ? 'text-success' : 'text-danger');  return health;
}

async function refreshReadiness() {
  const readiness = await api('/api/system/readiness');
  const result = $('#readinessResult');
  const list = $('#readinessList');
  const statusText = readiness.status === 'ready' ? '可部署' : (readiness.status === 'warning' ? '有警告' : '尚未就緒');
  if (result) {
    result.textContent = `${statusText} · 這是單一操作員 JSON 模式檢查，不代表已完成登入與 HTTPS。`;
    result.className = 'helper ' + (readiness.status === 'ready' ? 'text-success' : 'text-danger');
  }
  if (list) {
    list.innerHTML = '<div class="backup-list-heading"><strong>部署前置條件</strong><span>' + escapeHtml(statusText) + '</span></div>' + (readiness.checks || []).map((item) => (
      '<div class="backup-row"><div><strong>' + escapeHtml(item.id) + ' · ' + escapeHtml(item.status) + '</strong><small>' + escapeHtml(item.message) + '</small></div></div>'
    )).join('');
  }
  return readiness;
}

export function initSystemTools(onRestored) {
  $('#btnCreateBackup')?.addEventListener('click', async () => {
    try {
      const manifest = await api('/api/system/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeMedia: includeMedia() }),
      });
      setMessage('備份已建立：' + manifest.id, 'success');
      await refreshBackups();
    } catch (error) {
      setMessage(error.message, 'danger');
    }
  });

  $('#btnRefreshStorage')?.addEventListener('click', async () => {
    try {
      await refreshStorageHealth();
      setMessage('儲存狀態已更新。', 'success');
    } catch (error) {
      setMessage(error.message, 'danger');
    }
  });

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

  $('#btnRefreshSystemHealth')?.addEventListener('click', async () => {
    try {
      await refreshSystemHealth();
      setMessage('系統健康狀態已更新。', 'success');
    } catch (error) {
      setMessage(error.message, 'danger');
    }
  });

  $('#btnRefreshReadiness')?.addEventListener('click', async () => {
    try {
      await refreshReadiness();
      setMessage('部署前置檢查已更新。', 'success');
    } catch (error) {
      setMessage(error.message, 'danger');
    }
  });

  $('#btnCleanupMedia')?.addEventListener('click', async () => {
    try {
      const preview = await api('/api/system/media-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      });
      const count = preview.health.uploads.orphanFileCount;
      if (!count || !window.confirm('確認刪除 ' + count + ' 個未被內容引用的素材？此操作無法復原，建議先建立備份。')) return;
      await api('/api/system/media-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      await refreshStorageHealth();
      setMessage('未使用素材已清理。', 'success');
    } catch (error) {
      setMessage(error.message, 'danger');
    }
  });

  $('#backupList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-restore-backup]');
    if (!button || !window.confirm('還原前會先自動建立安全備份，確定還原這份資料？')) return;
    try {
      button.disabled = true;
      const result = await api('/api/system/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId: button.dataset.restoreBackup, includeMedia: includeMedia() }),
      });
      await refreshBackups();
      await refreshStorageHealth();
      setMessage('還原完成；安全備份：' + result.safetyBackup.id, 'success');
      if (typeof onRestored === 'function') await onRestored();
      showToast('資料已還原', 'success');
    } catch (error) {
      button.disabled = false;
      setMessage(error.message, 'danger');
    }
  });

  refreshBackups().catch(() => {});
  refreshStorageHealth().catch(() => {});
  refreshErrorLog().catch(() => {});
  refreshSystemHealth().catch(() => {});
  refreshReadiness().catch(() => {});
}
