import { $, escapeHtml, formatDate, isVideoPath, showToast } from './dom.js';
import { state, PLATFORM_NAMES, mediaPathsOf, clientQuery } from './state.js';
import { api, createIdempotencyKey } from './api.js';
import { publishTargetWithRecovery } from './long-task.js';
import { loadPost } from './drafts.js';
import { previewMediaSrc } from './media-preview.js';
import { publishingStatusGroup, targetStatusLabel, targetStatusSummary } from './status.js';
import { LIST_PAGE_SIZE, paginate, removeListPager, syncListPager } from './pagination.js';

const filters = { status: 'all', platform: 'all' };
let publishingPage = 1;

function postTitle(post) {
  return post?.title || post?.internalTitle || post?.contentTopic || post?.godName || '未命名內容';
}

function targetOf(post, item) {
  return (post?.targets || []).find((target) => target.id === item.targetId) || null;
}

function logText(post, item) {
  const target = targetOf(post, item);
  if (target?.copyOverride != null && String(target.copyOverride).trim() !== '') {
    return String(target.copyOverride).trim();
  }
  const contentType = item.contentType || target?.contentType || 'post';
  if (contentType === 'reel') {
    return String(post?.reel || post?.text || post?.facebook || '').trim();
  }
  return String(post?.facebook || post?.text || post?.reel || '').trim();
}

function groupOf(status) {
  return publishingStatusGroup(status);
}

function platformLabel(platformId) {
  if (platformId === 'facebook') return 'Facebook';
  if (platformId === 'instagram') return 'Instagram';
  if (platformId === 'threads') return 'Threads';
  return PLATFORM_NAMES[platformId] || platformId || '未指定平台';
}

function contentTypeLabel(item) {
  const platform = (state.platforms || []).find((entry) => entry.id === item.channel);
  const type = (platform?.contentTypes || []).find((entry) => entry.id === (item.contentType || 'post'));
  if (type?.name) return type.name;
  if (item.contentType === 'reel') return 'Reels';
  if (item.contentType === 'story') return '限時動態';
  return '貼文';
}

function accountLabel(item) {
  return (state.accounts || []).find((entry) => entry.id === item.accountId)?.name || '';
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
    removeListPager(list);
    list.className = 'list-empty module-empty';
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">↗</span><p>' + (items.length ? '找不到符合條件的發布紀錄。' : '還沒有發布紀錄。') + '</p></div>';
    return;
  }
  const paged = paginate(visible, { page: publishingPage, pageSize: LIST_PAGE_SIZE });
  publishingPage = paged.page;
  list.className = 'record-list content-list publishing-log-list';
  list.innerHTML = paged.items.map((item) => {
    const post = state.posts.find((record) => record.id === item.postId) || {};
    const target = targetOf(post, item);
    const firstMedia = previewMediaSrc((target?.mediaPaths && target.mediaPaths[0]) || mediaPathsOf(post)[0] || '');
    const thumbnail = !firstMedia ? '<span aria-hidden="true">✦</span>'
      : isVideoPath(firstMedia)
        ? '<video src="' + escapeHtml(firstMedia) + '" muted playsinline preload="metadata"></video>'
        : '<img src="' + escapeHtml(firstMedia) + '" alt="" />';
    const text = logText(post, item);
    const excerpt = escapeHtml(text.slice(0, 92)) + (text.length > 92 ? '…' : '');
    const status = item.status || 'draft';
    const error = item.lastError?.message
      ? '<p class="publishing-log-error">' + escapeHtml(item.lastError.message) + '</p>'
      : '';
    const retryBlocked = ['REMOTE_PUBLISH_RECONCILIATION_REQUIRED', 'REMOTE_SCHEDULE_RECONCILIATION_REQUIRED']
      .includes(item.lastError?.code);
    const retryAction = !retryBlocked && (status === 'failed' || status === 'retrying')
      ? '<button class="content-card-action" type="button" data-publishing-action="retry" data-target-id="' + escapeHtml(item.targetId) + '" data-post-id="' + escapeHtml(item.postId || '') + '">重試發布</button>'
      : '';
    const calendarAction = status === 'scheduled'
      ? '<a class="content-card-action" href="#/calendar">前往日曆</a>'
      : '';
    const meta = [
      accountLabel(item),
      contentTypeLabel(item),
      item.scheduledAt ? '排程：' + formatDate(item.scheduledAt) : '未指定時間',
      item.publishedAt ? '發布：' + formatDate(item.publishedAt) : '',
      item.attempts > 1 ? '第 ' + item.attempts + ' 次' : '',
    ].filter(Boolean).join(' · ');
    const platformChips = '<span class="platform-chip" data-platform="' + escapeHtml(item.channel || '') + '">'
      + escapeHtml(platformLabel(item.channel)) + '</span>';
    const targetSummary = targetStatusSummary([{
      platformId: item.channel,
      status,
    }], PLATFORM_NAMES);
    const title = postTitle(post);
    return '<article class="record-card content-card publishing-log-card" data-status="' + escapeHtml(status) + '">'
      + '<button class="record-card-main" type="button" data-open-post="' + escapeHtml(item.postId || '') + '" aria-label="開啟貼文 ' + escapeHtml(title) + '">'
      + '<span class="record-thumb">' + thumbnail + '</span>'
      + '<span class="record-body"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(meta) + '</small><span>'
      + (excerpt || '尚未填寫文案') + '</span><span class="content-platforms">' + platformChips
      + '</span><small class="content-status-detail">' + escapeHtml(targetSummary) + '</small>' + error + '</span>'
      + '</button>'
      + '<span class="content-card-side"><em class="content-status" data-status="' + escapeHtml(status) + '">'
      + escapeHtml(targetStatusLabel(status)) + '</em><span class="content-card-actions">'
      + '<button class="content-card-action" type="button" data-publishing-action="view" data-post-id="' + escapeHtml(item.postId || '') + '">查看內容</button>'
      + retryAction + calendarAction + '</span></span>'
      + '</article>';
  }).join('');
  syncListPager(list, paged, {
    label: '發布紀錄分頁',
    onPage: (page) => {
      publishingPage = page;
      renderPublishingLogs();
    },
  });
}

export function initPublishingLogs(refreshListsFn) {
  document.querySelectorAll('input[name="publishingStatus"]').forEach((input) => input.addEventListener('change', () => {
    filters.status = input.value;
    publishingPage = 1;
    renderPublishingLogs();
  }));
  document.querySelectorAll('input[name="publishingPlatform"]').forEach((input) => input.addEventListener('change', () => {
    filters.platform = input.value;
    publishingPage = 1;
    renderPublishingLogs();
  }));
  $('#publishingLogList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-publishing-action]');
    const openButton = event.target.closest('[data-open-post]');
    if (button) {
      event.stopPropagation();
      if (button.dataset.publishingAction === 'view') {
        if (button.dataset.postId) loadPost(button.dataset.postId);
        return;
      }
      const item = state.schedule.find((record) => record.targetId === button.dataset.targetId);
      if (!item) return;
      if (button.dataset.busy === 'true') return;
      if (!window.confirm('確定重試此平台發布？')) return;
      try {
        button.dataset.busy = 'true';
        button.disabled = true;
        await publishTargetWithRecovery({
          api,
          postId: item.postId || button.dataset.postId,
          targetId: item.targetId,
          createIdempotencyKey,
          loadPost: async () => {
            const postId = item.postId || button.dataset.postId;
            const posts = await api(clientQuery('/api/posts'));
            return (Array.isArray(posts) ? posts : []).find((entry) => entry.id === postId) || null;
          },
        });
        if (typeof refreshListsFn === 'function') await refreshListsFn();
        showToast('已重新送出平台發布。', 'success');
      } catch (error) {
        if (typeof refreshListsFn === 'function') await refreshListsFn();
        showToast(error.message || '重試發布失敗。', 'error');
      } finally {
        button.dataset.busy = 'false';
        button.disabled = false;
      }
      return;
    }
    if (openButton?.dataset.openPost) loadPost(openButton.dataset.openPost);
  });
}
