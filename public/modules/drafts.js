import { $, escapeHtml, formatDate, isVideoPath, setPreviewMessage, showToast } from './dom.js';
import { api } from './api.js';
import { state, mediaPathsOf, PLATFORM_NAMES } from './state.js';
import { previewMediaSrc } from './media-preview.js';
import { renderGenerated, restoreRecoverySnapshotForPost } from './editor.js';
import { setActiveView } from './tabs.js';
import { contentStageLabel, postStatusLabel, targetStatusSummary } from './status.js';

let refreshListsCallback = null;

const filters = {
  query: '',
  status: 'all',
  platform: 'all',
  stage: 'all',
};

function targetsOf(post) {
  if (Array.isArray(post.targets) && post.targets.length) return post.targets;
  return [{ platformId: post.channel || 'facebook', status: post.status || 'draft', scheduledAt: post.scheduledAt || null }];
}

function postTitle(post) {
  return post.title || post.internalTitle || post.contentTopic || post.godName || '未命名內容';
}

function postText(post) {
  return String(post.facebook || post.text || post.reel || '').trim();
}

function matchesFilters(post) {
  const targets = targetsOf(post);
  const postStatus = String(post.status || 'draft');
  const statusMatches = filters.status === 'archived'
    ? postStatus === 'archived'
    : filters.status === 'all'
      ? postStatus !== 'archived'
      : postStatus === filters.status;
  const platformMatches = filters.platform === 'all' || targets.some((target) => target.platformId === filters.platform);
  const stageMatches = filters.stage === 'all' || String(post.contentStage || 'draft') === filters.stage;
  if (!statusMatches || !platformMatches || !stageMatches) return false;
  if (!filters.query) return true;
  const haystack = [postTitle(post), postText(post), post.extraNotes, post.postType].join(' ').toLowerCase();
  return haystack.includes(filters.query.toLowerCase());
}

function statusLabel(status) {
  return postStatusLabel(status);
}

function platformLabel(platformId) {
  if (platformId === 'facebook') return 'Facebook';
  if (platformId === 'instagram') return 'Instagram';
  if (platformId === 'threads') return 'Threads';
  return PLATFORM_NAMES[platformId] || platformId || '未指定平台';
}

function renderEmpty(container, isFiltered) {
  container.className = 'list-empty content-list-empty';
  container.innerHTML = isFiltered
    ? '<div class="empty-state"><span class="empty-icon">⌕</span><p>找不到符合條件的內容。</p><button class="btn-text" type="button" data-clear-content-filters>清除篩選</button></div>'
    : '<div class="empty-state"><span class="empty-icon">📝</span><p>還沒有內容，從「新增內容」開始。</p><a class="btn-text" href="#/content/new" data-view-target="create" data-route-target="content/new">＋ 新增內容</a></div>';
  const clearButton = container.querySelector('[data-clear-content-filters]');
  clearButton?.addEventListener('click', () => {
    filters.query = '';
    filters.status = 'all';
    filters.platform = 'all';
    filters.stage = 'all';
    const search = $('#contentSearch');
    if (search) search.value = '';
    const allStatus = document.querySelector('input[name="contentStatus"][value="all"]');
    const allPlatform = document.querySelector('input[name="contentPlatform"][value="all"]');
    const allStage = document.querySelector('input[name="contentStage"][value="all"]');
    if (allStatus) allStatus.checked = true;
    if (allPlatform) allPlatform.checked = true;
    if (allStage) allStage.checked = true;
    renderPosts();
  });
}

async function runPostAction(action, postId) {
  const actionNames = { archive: '封存', restore: '還原', duplicate: '複製', 'promote-idea': '轉成草稿' };
  const actionName = actionNames[action] || '操作';
  if (!window.confirm(`確定要${actionName}這篇貼文嗎？`)) return;
  try {
    const options = { method: 'POST' };
    if (action === 'duplicate') {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({});
    }
    if (action === 'promote-idea') {
      options.method = 'PATCH';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ contentStage: 'draft', versionSource: 'manual' });
    }
    const endpoint = action === 'promote-idea'
      ? '/api/posts/' + encodeURIComponent(postId)
      : '/api/posts/' + encodeURIComponent(postId) + '/' + action;
    await api(endpoint, options);
    showToast(`貼文已${actionName}`, 'success');
    if (refreshListsCallback) await refreshListsCallback();
    else renderPosts();
  } catch (error) {
    showToast(error.message || `${actionName}失敗`, 'error');
  }
}
export function renderPosts() {
  const container = $('#postsList');
  if (!container) return;
  const visiblePosts = state.posts.filter(matchesFilters);
  if (!visiblePosts.length) {
    renderEmpty(container, Boolean(state.posts.length));
    return;
  }

  container.className = 'record-list content-list';
  container.innerHTML = visiblePosts.slice(0, 40).map((post) => {
    const firstMedia = previewMediaSrc(mediaPathsOf(post)[0]);
    const thumbnail = !firstMedia ? '<span aria-hidden="true">✦</span>'
      : isVideoPath(firstMedia)
        ? '<video src="' + escapeHtml(firstMedia) + '" muted playsinline preload="metadata"></video>'
        : '<img src="' + escapeHtml(firstMedia) + '" alt="" />';
    const text = postText(post);
    const excerpt = escapeHtml(text.slice(0, 92)) + (text.length > 92 ? '…' : '');
    const targets = targetsOf(post);
    const scheduleTarget = targets.find((target) => target.scheduledAt);
    const platformChips = targets.slice(0, 3)
      .map((target) => '<span class="platform-chip" data-platform="' + escapeHtml(target.platformId) + '">' + escapeHtml(platformLabel(target.platformId)) + '</span>')
      .join('');
    const morePlatforms = targets.length > 3 ? '<span class="platform-chip platform-chip-more">+' + (targets.length - 3) + '</span>' : '';
    const status = String(post.status || 'draft');
    const contentStage = String(post.contentStage || 'draft');
    const stageLabel = contentStageLabel(contentStage);
    const targetSummary = targetStatusSummary(targets, PLATFORM_NAMES);
    const updated = post.updatedAt || post.createdAt;
    const meta = [
      updated ? formatDate(updated) : '',
      scheduleTarget?.scheduledAt ? '排程：' + formatDate(scheduleTarget.scheduledAt) : '',
      post.archivedAt ? '封存：' + formatDate(post.archivedAt) : '',
    ].filter(Boolean).join(' · ');
    const lifecycleActions = contentStage === 'idea'
      ? '<button class="content-card-action" type="button" data-post-action="promote-idea" data-post-id="' + escapeHtml(post.id) + '">轉成草稿</button>'
      : status === 'archived'
      ? '<button class="content-card-action" type="button" data-post-action="restore" data-post-id="' + escapeHtml(post.id) + '">還原</button>'
      : '<button class="content-card-action" type="button" data-post-action="archive" data-post-id="' + escapeHtml(post.id) + '">封存</button>';
    return '<article class="record-card content-card" data-status="' + escapeHtml(status) + '">' +
      '<button class="record-card-main" type="button" data-open-post="' + escapeHtml(post.id) + '" aria-label="開啟貼文 ' + escapeHtml(postTitle(post)) + '">' +
      '<span class="record-thumb">' + thumbnail + '</span>' +
      '<span class="record-body"><strong>' + escapeHtml(postTitle(post)) + '</strong><small>' + escapeHtml(meta || '尚無更新時間') + '</small><span>' + (excerpt || '尚未填寫文案') + '</span><span class="content-platforms">' + platformChips + morePlatforms + '</span><small class="content-status-detail">' + escapeHtml(targetSummary) + '</small></span>' +
      '</button>' +
      '<span class="content-card-side"><em class="content-status" data-status="' + escapeHtml(contentStage === 'idea' ? 'idea' : status) + '">' + escapeHtml(contentStage === 'idea' ? stageLabel : statusLabel(status)) + '</em><span class="content-card-actions">' + lifecycleActions + '<button class="content-card-action" type="button" data-post-action="duplicate" data-post-id="' + escapeHtml(post.id) + '">複製</button></span></span>' +
      '</article>';
  }).join('');

  container.querySelectorAll('[data-open-post]').forEach((button) => button.addEventListener('click', () => loadPost(button.dataset.openPost)));
  container.querySelectorAll('[data-post-action]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    runPostAction(button.dataset.postAction, button.dataset.postId);
  }));
}
export function initContentFilters(refreshListsFn = null) {
  refreshListsCallback = refreshListsFn;
  const search = $('#contentSearch');
  search?.addEventListener('input', () => {
    filters.query = search.value.trim();
    renderPosts();
  });
  document.querySelectorAll('input[name="contentStatus"]').forEach((input) => input.addEventListener('change', () => {
    filters.status = input.value;
    renderPosts();
  }));
  document.querySelectorAll('input[name="contentPlatform"]').forEach((input) => input.addEventListener('change', () => {
    filters.platform = input.value;
    renderPosts();
  }));
  document.querySelectorAll('input[name="contentStage"]').forEach((input) => input.addEventListener('change', () => {
    filters.stage = input.value;
    renderPosts();
  }));
  $('#ideaCaptureForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const topic = $('#ideaTopic')?.value?.trim() || '';
    if (!topic) return setPreviewMessage('請先輸入 Idea 主題。', 'error');
    try {
      await api('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: state.currentClientId,
          contentTopic: topic,
          contentStage: 'idea',
          facebook: '',
          extraNotes: $('#ideaNotes')?.value?.trim() || '',
        }),
      });
      $('#ideaTopic').value = '';
      $('#ideaNotes').value = '';
      showToast('Idea 已保存。', 'success');
      if (refreshListsCallback) await refreshListsCallback();
    } catch (error) {
      showToast(error.message || 'Idea 保存失敗。', 'error');
    }
  });
}

export async function loadPost(postId) {
  const post = state.posts.find((record) => record.id === postId);
  if (!post) return;
  const restored = post.status === 'archived' ? false : restoreRecoverySnapshotForPost(post);
  if (!restored) {
    state.savedPost = post;
    renderGenerated(post);
  }
  setActiveView('review');
  setPreviewMessage(restored
    ? '已從本機復原未儲存修改，請確認後等待自動儲存。'
    : post.contentStage === 'idea'
      ? 'Idea 已載入；先轉成草稿，再開始產生文案與排程。'
    : post.status === 'archived'
      ? '貼文已封存，請回到內容列表還原後再編輯。'
      : '已載入貼文。');
  const panel = $('#reviewPanel');  if (panel) window.scrollTo({ top: panel.offsetTop - 24, behavior: 'smooth' });
}
