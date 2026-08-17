import { escapeHtml, formatDate } from './dom.js';

export const ERROR_LOG_PERMISSION = 'system.manage';

const DETAIL_FIELDS = [
  ['message', '訊息'],
  ['detail', '詳細'],
  ['source', '來源'],
  ['scope', '範圍'],
  ['code', '代碼'],
  ['method', '方法'],
  ['path', '路徑'],
  ['status', '狀態碼'],
  ['platformId', '平台'],
  ['createdAt', '首次出現'],
  ['lastSeenAt', '最近出現'],
  ['count', '次數'],
  ['retriable', '可重試'],
  ['durationMs', '耗時'],
  ['fingerprint', '指紋'],
  ['id', '編號'],
];

export function canViewErrorLogs(hasPermissionFn) {
  return typeof hasPermissionFn === 'function' && hasPermissionFn(ERROR_LOG_PERMISSION);
}

export function errorLogStatusLabel(status) {
  return status === 'fixed' ? '已修正' : '未修正';
}

function hasDetailValue(key, value) {
  if (value == null || value === '') return false;
  if (key === 'retriable') return Boolean(value);
  if (key === 'durationMs') return Number.isFinite(Number(value));
  return true;
}

function formatDetailValue(key, value, formatDateFn) {
  if (key === 'createdAt' || key === 'lastSeenAt') return formatDateFn(value);
  if (key === 'retriable') return value ? '是' : '否';
  if (key === 'durationMs') return Number(value) + ' ms';
  return String(value);
}

function renderErrorLogDetail(entry, formatDateFn) {
  const rows = DETAIL_FIELDS
    .filter(([key]) => hasDetailValue(key, entry[key]))
    .map(([key, label]) => {
      const raw = formatDetailValue(key, entry[key], formatDateFn);
      const multiline = key === 'detail' || (key === 'message' && String(raw).includes('\n'));
      const body = multiline
        ? '<pre>' + escapeHtml(raw) + '</pre>'
        : escapeHtml(raw);
      return '<div class="error-log-field"><dt>' + escapeHtml(label) + '</dt><dd>' + body + '</dd></div>';
    })
    .join('');
  return '<dl class="error-log-detail-list">' + rows + '</dl>';
}

export function renderErrorLogListHtml(entries = [], {
  allowed = true,
  formatDate: formatDateFn = formatDate,
  countLabel = '',
} = {}) {
  if (!allowed) {
    return '<div class="empty-state module-empty"><span class="empty-icon">🔒</span><p>你沒有查看錯誤記錄的權限。</p></div>';
  }
  if (!entries.length) return '';
  const headingCount = countLabel || ('共 ' + entries.length + ' 筆');
  return '<div class="backup-list-heading"><strong>錯誤記錄</strong><span>' + escapeHtml(headingCount) + '</span></div>' + entries.map((entry) => {
    const count = Number(entry.count || 1);
    const resolved = entry.resolutionStatus === 'fixed';
    const action = resolved
      ? ''
      : '<button type="button" class="btn-text" data-resolve-error="' + escapeHtml(entry.id) + '">標已修正</button>';
    const title = escapeHtml(entry.scope || 'unknown')
      + ' · ' + escapeHtml(String(entry.status || entry.code || ''))
      + ' · ' + escapeHtml(errorLogStatusLabel(entry.resolutionStatus));
    const summary = escapeHtml(formatDateFn(entry.lastSeenAt || entry.createdAt))
      + ' · ' + count + ' 次 · ' + escapeHtml(entry.message || '');
    return '<div class="backup-row error-log-row">'
      + '<details class="disclosure compact error-log-fold">'
      + '<summary aria-label="展開錯誤詳情">'
      + '<span class="error-log-summary"><strong>' + title + '</strong><small>' + summary + '</small></span>'
      + '<span class="chevron" aria-hidden="true">›</span>'
      + '</summary>'
      + '<div class="disclosure-body error-log-detail">'
      + renderErrorLogDetail(entry, formatDateFn)
      + '</div>'
      + '</details>'
      + action
      + '</div>';
  }).join('');
}
