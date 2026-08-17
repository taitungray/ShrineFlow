import { escapeHtml, showToast } from './dom.js';
import { api } from './api.js';
import { hasPermission, state } from './state.js';
import { loadPost } from './drafts.js';
import { LIST_PAGE_SIZE, paginate, removeListPager, syncListPager } from './pagination.js';

let reviewPage = 1;

const STATE_LABELS = Object.freeze({
  draft: '草稿',
  in_review: '審核中',
  approved: '已核准',
  changes_requested: '要求修改',
});

let refreshListsCallback = null;

function titleOf(post) {
  return post.contentTopic || post.godName || post.title || '未命名內容';
}

export function renderReviewQueue() {
  const list = document.getElementById('reviewQueueList');
  if (!list) return;
  if (!state.reviewQueue.length) {
    removeListPager(list);
    list.className = 'list-empty review-list-empty';
    list.innerHTML = '<div class=empty-state><p>目前沒有待處理的審核項目。</p></div>';
    return;
  }
  const paged = paginate(state.reviewQueue, { page: reviewPage, pageSize: LIST_PAGE_SIZE });
  reviewPage = paged.page;
  list.className = 'record-list review-list test';
  const canApprove = hasPermission('content.approve');
  list.innerHTML = paged.items.map((post) => {
    const stateLabel = STATE_LABELS[post.approvalState] || post.approvalState || '草稿';
    const id = escapeHtml(post.id);
    const actions = post.approvalState === 'in_review' && canApprove
      ? '<button class=review-action data-review-action=changes data-review-id=' + id + '>要求修改</button><button class=review-action data-review-action=approve data-review-id=' + id + '>核准</button>'
      : '';
    return '<article class=record-card><button class=record-card-main data-review-open=' + id + '><strong>' + escapeHtml(titleOf(post)) + '</strong><small>版本 ' + escapeHtml(String(post.currentVersion || post.version || 1)) + '</small></button><span class=content-card-side><em class=content-status>' + escapeHtml(stateLabel) + '</em>' + actions + '</span></article>';
  }).join('');
  list.querySelectorAll('[data-review-open]').forEach((button) => {
    button.addEventListener('click', () => loadPost(button.dataset.reviewOpen));
  });
  list.querySelectorAll('[data-review-action]').forEach((button) => {
    button.addEventListener('click', () => runReviewAction(button.dataset.reviewAction, button.dataset.reviewId));
  });
  syncListPager(list, paged, {
    label: '審核分頁',
    onPage: (page) => {
      reviewPage = page;
      renderReviewQueue();
    },
  });
}

async function runReviewAction(action, postId) {
  const path = action === 'approve' ? 'approve' : 'request-changes';
  const note = action === 'changes' ? window.prompt('請輸入修改意見（可留白）：', '') : '';
  if (action === 'changes' && note === null) return;
  try {
    await api('/api/posts/' + encodeURIComponent(postId) + '/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'changes' ? { note } : {}),
    });
    showToast(action === 'approve' ? '內容已核准。' : '已要求修改。', 'success');
    if (refreshListsCallback) await refreshListsCallback();
  } catch (error) {
    showToast(error.message || '審核操作失敗。', 'error');
  }
}

export async function loadReviewQueue() {
  const query = state.currentClientId ? '?clientId=' + encodeURIComponent(state.currentClientId) : '';
  state.reviewQueue = await api('/api/review-queue' + query);
  renderReviewQueue();
}

export function initReviewListeners(refreshListsFn = null) {
  refreshListsCallback = refreshListsFn;
  document.getElementById('refreshReviewButton')?.addEventListener('click', () => {
    loadReviewQueue().catch((error) => showToast(error.message || '審核佇列載入失敗。', 'error'));
  });
}
