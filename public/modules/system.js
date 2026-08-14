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
}
