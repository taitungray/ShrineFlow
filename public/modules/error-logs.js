import { escapeHtml, formatDate } from './dom.js';

export const ERROR_LOG_PERMISSION = 'system.manage';

export function canViewErrorLogs(hasPermissionFn) {
  return typeof hasPermissionFn === 'function' && hasPermissionFn(ERROR_LOG_PERMISSION);
}

export function errorLogStatusLabel(status) {
  return status === 'fixed' ? '已修正' : '未修正';
}

export function renderErrorLogListHtml(entries = [], {
  allowed = true,
  formatDate: formatDateFn = formatDate,
} = {}) {
  if (!allowed) {
    return '<div class="empty-state module-empty"><span class="empty-icon">🔒</span><p>你沒有查看錯誤記錄的權限。</p></div>';
  }
  if (!entries.length) return '';
  return '<div class="backup-list-heading"><strong>錯誤記錄</strong><span>最多顯示 50 筆</span></div>' + entries.map((entry) => {
    const count = Number(entry.count || 1);
    const resolved = entry.resolutionStatus === 'fixed';
    const action = resolved
      ? ''
      : '<button type="button" class="btn-text" data-resolve-error="' + escapeHtml(entry.id) + '">標已修正</button>';
    return '<div class="backup-row"><div><strong>' + escapeHtml(entry.scope || 'unknown')
      + ' · ' + escapeHtml(String(entry.status || entry.code || ''))
      + ' · ' + escapeHtml(errorLogStatusLabel(entry.resolutionStatus))
      + '</strong><small>' + escapeHtml(formatDateFn(entry.lastSeenAt || entry.createdAt))
      + ' · ' + count + ' 次 · ' + escapeHtml(entry.message || '')
      + '</small></div>' + action + '</div>';
  }).join('');
}
