import { $, escapeHtml, formatDate, isVideoPath } from './dom.js';
import { api } from './api.js';
import { state, mediaPathsOf, clientQuery } from './state.js';
import { previewMediaSrc } from './media-preview.js';
import { annotateMediaDuplicates } from './media-picker.js';
import { loadPost } from './drafts.js';
import { GRID_PAGE_SIZE, paginate, removeListPager, syncListPager } from './pagination.js';
import { platformChipHtml } from './platform-icon.js';

const filters = { query: '', type: 'all' };
let mediaPage = 1;
let mediaAssets = [];

function postTitle(post) {
  return post.title || post.internalTitle || post.contentTopic || post.godName || '未命名內容';
}

function mediaName(path) {
  const cleanPath = String(path || '').split(/[?#]/)[0];
  const name = cleanPath.split('/').pop() || '未命名素材';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function collectMedia() {
  const byPath = new Map();
  state.posts.forEach((post) => {
    const paths = mediaPathsOf(post);
    paths.forEach((path) => {
      if (!path) return;
      const key = String(path);
      const current = byPath.get(key) || {
        path: key,
        posts: [],
        platforms: new Set(),
        latestAt: post.updatedAt || post.createdAt || '',
      };
      current.posts.push({ id: post.id, title: postTitle(post) });
      (post.targets || []).forEach((target) => current.platforms.add(target.platformId));
      if (new Date(post.updatedAt || post.createdAt || 0) > new Date(current.latestAt || 0)) {
        current.latestAt = post.updatedAt || post.createdAt || '';
      }
      byPath.set(key, current);
    });
  });
  return [...byPath.values()].sort((a, b) => new Date(b.latestAt || 0) - new Date(a.latestAt || 0));
}

function renderEmpty(container, filtered) {
  removeListPager(container);
  container.className = 'list-empty module-empty';
  container.innerHTML = filtered
    ? '<div class="empty-state"><span class="empty-icon">⌕</span><p>找不到符合條件的素材。</p><button class="btn-text" type="button" data-clear-media-filters>清除篩選</button></div>'
    : '<div class="empty-state"><span class="empty-icon">▧</span><p>還沒有素材，從「新增內容」上傳第一個圖片或影片。</p><a class="btn-text" href="#/content/new">＋ 新增內容</a></div>';
  container.querySelector('[data-clear-media-filters]')?.addEventListener('click', () => {
    filters.query = '';
    filters.type = 'all';
    if ($('#mediaSearch')) $('#mediaSearch').value = '';
    document.querySelector('input[name="mediaType"][value="all"]')?.click();
    mediaPage = 1;
    renderMediaLibrary();
  });
}

export async function loadMediaLibraryAssets() {
  try {
    const payload = await api(clientQuery('/api/media'));
    mediaAssets = Array.isArray(payload?.assets) ? payload.assets : [];
  } catch {
    mediaAssets = [];
  }
  return mediaAssets;
}

export function renderMediaLibrary() {
  const grid = $('#mediaGrid');
  const summary = $('#mediaSummary');
  if (!grid) return;
  const allMedia = annotateMediaDuplicates(collectMedia(), mediaAssets);
  const duplicateCount = allMedia.filter((item) => item.duplicateCount > 1).length;
  const visible = allMedia.filter((item) => {
    const type = isVideoPath(item.path) ? 'video' : 'image';
    if (filters.type === 'duplicate') {
      if (item.duplicateCount < 2) return false;
    } else if (filters.type !== 'all' && filters.type !== type) {
      return false;
    }
    if (!filters.query) return true;
    const haystack = [mediaName(item.path), ...item.posts.map((post) => post.title)].join(' ').toLowerCase();
    return haystack.includes(filters.query.toLowerCase());
  });
  if (summary) {
    const used = allMedia.filter((item) => item.posts.length > 0).length;
    summary.textContent = `共 ${allMedia.length} 個素材 · 圖片 ${allMedia.filter((item) => !isVideoPath(item.path)).length} · 影片 ${allMedia.filter((item) => isVideoPath(item.path)).length} · 使用中 ${used}`
      + (duplicateCount ? ` · 重複 ${duplicateCount}` : '');
  }
  if (!visible.length) {
    renderEmpty(grid, Boolean(allMedia.length));
    return;
  }
  const paged = paginate(visible, { page: mediaPage, pageSize: GRID_PAGE_SIZE });
  mediaPage = paged.page;
  grid.className = 'media-library-grid';
  grid.innerHTML = paged.items.map((item) => {
    const video = isVideoPath(item.path);
    const name = mediaName(item.path);
    const platforms = [...item.platforms].slice(0, 3).map((platformId) => platformChipHtml(platformId)).join('');
    const src = previewMediaSrc(item.path);
    const preview = video
      ? '<video src="' + escapeHtml(src) + '" muted playsinline preload="metadata" aria-label="' + escapeHtml(name) + '"></video>'
      : '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(name) + '" loading="lazy" />';
    const firstPost = item.posts[0];
    const isUsed = item.posts.length > 0;
    const usageBadge = isUsed
      ? '<span class="media-usage-badge is-used" title="已使用於 ' + item.posts.length + ' 篇內容">✓ ' + item.posts.length + ' 篇引用</span>'
      : '<span class="media-usage-badge is-unused">未使用</span>';
    const duplicateBadge = item.duplicateCount > 1
      ? '<span class="media-usage-badge is-duplicate">重複 ×' + item.duplicateCount + '</span>'
      : '';
    return '<article class="media-library-card' + (isUsed ? '' : ' is-unused') + (item.duplicateCount > 1 ? ' is-duplicate' : '') + '">'
      + '<div class="media-library-preview" data-type="' + (video ? 'video' : 'image') + '">'
      + preview
      + usageBadge
      + duplicateBadge
      + '</div>'
      + '<div class="media-library-body"><strong title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</strong>'
      + '<small>' + (isUsed ? '使用於 ' + item.posts.length + ' 篇內容' : '尚未被任何內容使用') + (item.latestAt ? ' · ' + escapeHtml(formatDate(item.latestAt)) : '') + '</small>'
      + '<span class="content-platforms">' + (platforms || '<span class="helper">尚未指定平台</span>') + '</span></div>'
      + '<div class="media-library-actions">' + (firstPost ? '<button class="btn-text" type="button" data-media-post-id="' + escapeHtml(firstPost.id) + '">查看相關貼文 →</button>' : '<span class="helper">可於新增內容引用</span>') + '</div>'
      + '</article>';
  }).join('');
  syncListPager(grid, paged, {
    label: '素材庫分頁',
    onPage: (page) => {
      mediaPage = page;
      renderMediaLibrary();
    },
  });
}

export function initMediaLibrary() {
  $('#mediaSearch')?.addEventListener('input', (event) => {
    filters.query = event.target.value.trim();
    mediaPage = 1;
    renderMediaLibrary();
  });
  document.querySelectorAll('input[name="mediaType"]').forEach((input) => input.addEventListener('change', () => {
    filters.type = input.value;
    mediaPage = 1;
    renderMediaLibrary();
  }));
  $('#mediaGrid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-media-post-id]');
    if (button) loadPost(button.dataset.mediaPostId);
  });
}
