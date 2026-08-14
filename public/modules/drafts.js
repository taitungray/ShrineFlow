import { $, escapeHtml, formatDate, isVideoPath, setPreviewMessage } from './dom.js';
import { state, mediaPathsOf, PLATFORM_NAMES } from './state.js';
import { renderGenerated, restoreRecoverySnapshotForPost } from './editor.js';
import { setActiveView } from './tabs.js';
import { postStatusLabel, targetStatusSummary } from './status.js';

const filters = {
  query: '',
  status: 'all',
  platform: 'all',
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
  const statusMatches = filters.status === 'all' || String(post.status || 'draft') === filters.status;
  const platformMatches = filters.platform === 'all' || targets.some((target) => target.platformId === filters.platform);
  if (!statusMatches || !platformMatches) return false;
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
    const search = $('#contentSearch');
    if (search) search.value = '';
    const allStatus = document.querySelector('input[name="contentStatus"][value="all"]');
    const allPlatform = document.querySelector('input[name="contentPlatform"][value="all"]');
    if (allStatus) allStatus.checked = true;
    if (allPlatform) allPlatform.checked = true;
    renderPosts();
  });
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
    const firstMedia = mediaPathsOf(post)[0];
    const thumbnail = !firstMedia ? '✦' : isVideoPath(firstMedia)
      ? '<video src="' + escapeHtml(firstMedia) + '" muted playsinline preload="metadata"></video>'
      : '<img src="' + escapeHtml(firstMedia) + '" alt="" />';
    const text = postText(post);
    const excerpt = escapeHtml(text.slice(0, 92)) + (text.length > 92 ? '…' : '');
    const targets = targetsOf(post);
    const scheduleTarget = targets.find((target) => target.scheduledAt);
    const platformChips = targets.slice(0, 3).map((target) => '<span class="platform-chip" data-platform="' + escapeHtml(target.platformId) + '">' + escapeHtml(platformLabel(target.platformId)) + '</span>').join('');
    const morePlatforms = targets.length > 3 ? '<span class="platform-chip platform-chip-more">+' + (targets.length - 3) + '</span>' : '';
    const status = String(post.status || 'draft');
    const targetSummary = targetStatusSummary(targets, PLATFORM_NAMES);
    const updated = post.updatedAt || post.createdAt;
    const meta = [
      updated ? formatDate(updated) : '',
      scheduleTarget?.scheduledAt ? '預計 ' + formatDate(scheduleTarget.scheduledAt) : '',
    ].filter(Boolean).join(' · ');
    return '<button class="record-card content-card" id="draft-' + escapeHtml(post.id) + '" data-post-id="' + escapeHtml(post.id) + '" data-status="' + escapeHtml(status) + '" type="button" aria-label="載入內容 ' + escapeHtml(postTitle(post)) + '">' +
      '<span class="record-thumb">' + thumbnail + '</span>' +
      '<span class="record-body"><strong>' + escapeHtml(postTitle(post)) + '</strong><small>' + escapeHtml(meta || '剛剛') + '</small><span>' + (excerpt || '尚未填寫文案') + '</span><span class="content-platforms">' + platformChips + morePlatforms + '</span><small class="content-status-detail">' + escapeHtml(targetSummary) + '</small></span>' +
      '<span class="content-card-side"><em class="content-status" data-status="' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</em><span class="record-arrow">›</span></span></button>';
  }).join('');
  container.querySelectorAll('[data-post-id]').forEach((button) => button.addEventListener('click', () => loadPost(button.dataset.postId)));
}

export function initContentFilters() {
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
}

export async function loadPost(postId) {
  const post = state.posts.find((record) => record.id === postId);
  if (!post) return;
  const restored = restoreRecoverySnapshotForPost(post);
  if (!restored) {
    state.savedPost = post;
    renderGenerated(post);
  }
  setActiveView('review');
  setPreviewMessage(restored ? '已從本機復原未儲存修改，請確認後等待自動儲存。' : '已載入貼文。');
  const panel = $('#reviewPanel');  if (panel) window.scrollTo({ top: panel.offsetTop - 24, behavior: 'smooth' });
}
