import { $, escapeHtml, formatDate, showToast } from './dom.js';
import { state, PLATFORM_NAMES } from './state.js';
import { api } from './api.js';
import { loadPost } from './drafts.js';
import { publishingStatusGroup, targetStatusLabel } from './status.js';

const filters = { status: 'all', platform: 'all' };
function postTitle(post) {
  return post?.title || post?.internalTitle || post?.contentTopic || post?.godName || '未命名內容';
}

function groupOf(status) {
  return publishingStatusGroup(status);
}

function platformLabel(platformId) {
  return PLATFORM_NAMES[platformId] || platformId || '未指定平台';
}

function renderSummary(items) {
  const summary = $('#publishingSummary');
  if (!summary) return;
  const values = [
    ['全部目標', items.length, 'all'],
    ['進行中', items.filter((item) => groupOf(item.status) === 'queue').length, 'queue'],
    ['已成功', items.filter((item) => item.status === 'published').length, 'success'],
    ['需處理', items.filter((item) => groupOf(item.status) === 'attention').length, 'attention'],
  ];
  summary.innerHTML = values.map(([label, count, type]) => '<button type="button" class="module-summary-card" data-publishing-summary-filter="' + type + '"><span>' + label + '</span><strong>' + count + '</strong></button>').join('');
  summary.querySelectorAll('[data-publishing-summary-filter]').forEach((button) => button.addEventListener('click', () => {
    filters.status = button.dataset.publishingSummaryFilter;
    document.querySelector('input[name="publishingStatus"][value="' + filters.status + '"]')?.click();
    renderPublishingLogs();
  }));
}

export function renderPublishingLogs() {
  const list = $('#publishingLogList');
  if (!list) return;
  const items = [...state.schedule].sort((a, b) => new Date(b.scheduledAt || b.updatedAt || 0) - new Date(a.scheduledAt || a.updatedAt || 0));
  renderSummary(items);
  const visible = items.filter((item) => (
    (filters.status === 'all' || groupOf(item.status) === filters.status)
    && (filters.platform === 'all' || item.channel === filters.platform)
  ));
  if (!visible.length) {
    list.className = 'list-empty module-empty';
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">↗</span><p>' + (items.length ? '找不到符合條件的發布紀錄。' : '還沒有發布紀錄。') + '</p></div>';
    return;
  }
  list.className = 'publishing-log-list';
  list.innerHTML = visible.slice(0, 60).map((item) => {
    const post = state.posts.find((record) => record.id === item.postId);
    const status = item.status || 'draft';
    const error = item.lastError?.message ? '<p class="publishing-log-error">' + escapeHtml(item.lastError.message) + '</p>' : '';
    const action = status === 'failed' || status === 'retrying'
      ? '<button class="btn-text" type="button" data-publishing-action="retry" data-target-id="' + escapeHtml(item.targetId) + '" data-post-id="' + escapeHtml(item.postId || '') + '">重試發布</button>'
      : status === 'scheduled'
        ? '<a class="btn-text" href="#/calendar">前往日曆</a>'
        : '';
    return '<article class="publishing-log-card" data-status="' + escapeHtml(status) + '">'
      + '<span class="publishing-log-icon" data-status="' + escapeHtml(status) + '" aria-hidden="true">' + (status === 'published' ? '✓' : status === 'failed' ? '!' : '↗') + '</span>'
      + '<div class="publishing-log-main"><div class="publishing-log-heading"><strong>' + escapeHtml(postTitle(post)) + '</strong><em class="content-status" data-status="' + escapeHtml(status) + '">' + escapeHtml(targetStatusLabel(status)) + '</em></div>'
      + '<p>' + escapeHtml(platformLabel(item.channel)) + ' · ' + escapeHtml(item.contentType || '貼文') + ' · ' + escapeHtml(item.scheduledAt ? formatDate(item.scheduledAt) : '未指定時間') + (item.attempts > 1 ? ' · 第 ' + escapeHtml(item.attempts) + ' 次' : '') + '</p>' + error + '</div>'
      + '<div class="publishing-log-actions"><button class="btn-text" type="button" data-publishing-action="view" data-post-id="' + escapeHtml(item.postId || '') + '">查看內容</button>' + action + '</div>'
      + '</article>';
  }).join('');
}

export function initPublishingLogs(refreshListsFn) {
  document.querySelectorAll('input[name="publishingStatus"]').forEach((input) => input.addEventListener('change', () => {
    filters.status = input.value;
    renderPublishingLogs();
  }));
  document.querySelectorAll('input[name="publishingPlatform"]').forEach((input) => input.addEventListener('change', () => {
    filters.platform = input.value;
    renderPublishingLogs();
  }));
  $('#publishingLogList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-publishing-action]');
    if (!button) return;
    if (button.dataset.publishingAction === 'view') {
      if (button.dataset.postId) loadPost(button.dataset.postId);
      return;
    }
    const item = state.schedule.find((record) => record.targetId === button.dataset.targetId);
    if (!item) return;
    if (!window.confirm('確定重試此平台發布？')) return;
    try {
      button.disabled = true;
      await api('/api/publish/target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: item.postId || button.dataset.postId, targetId: item.targetId }),
      });
      if (typeof refreshListsFn === 'function') await refreshListsFn();
      showToast('已重新送出平台發布。', 'success');
    } catch (error) {
      if (typeof refreshListsFn === 'function') await refreshListsFn();
      showToast(error.message || '重試發布失敗。', 'error');
    }
  });
}
