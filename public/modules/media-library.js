import { $, escapeHtml, formatDate, isVideoPath } from './dom.js';
import { state, mediaPathsOf, PLATFORM_NAMES } from './state.js';
import { previewMediaSrc } from './media-preview.js';
import { loadPost } from './drafts.js';

const filters = { query: '', type: 'all' };

function postTitle(post) {
  return post.title || post.internalTitle || post.contentTopic || post.godName || '未命名內容';
}

function platformLabel(platformId) {
  return PLATFORM_NAMES[platformId] || platformId || '未指定平台';
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
  container.className = 'list-empty module-empty';
  container.innerHTML = filtered
    ? '<div class="empty-state"><span class="empty-icon">⌕</span><p>找不到符合條件的素材。</p><button class="btn-text" type="button" data-clear-media-filters>清除篩選</button></div>'
    : '<div class="empty-state"><span class="empty-icon">▧</span><p>還沒有素材，從「新增內容」上傳第一個圖片或影片。</p><a class="btn-text" href="#/content/new">＋ 新增內容</a></div>';
  container.querySelector('[data-clear-media-filters]')?.addEventListener('click', () => {
    filters.query = '';
    filters.type = 'all';
    if ($('#mediaSearch')) $('#mediaSearch').value = '';
    document.querySelector('input[name="mediaType"][value="all"]')?.click();
    renderMediaLibrary();
  });
}

export function renderMediaLibrary() {
  const grid = $('#mediaGrid');
  const summary = $('#mediaSummary');
  if (!grid) return;
  const allMedia = collectMedia();
  const visible = allMedia.filter((item) => {
    const type = isVideoPath(item.path) ? 'video' : 'image';
    if (filters.type !== 'all' && filters.type !== type) return false;
    if (!filters.query) return true;
    const haystack = [mediaName(item.path), ...item.posts.map((post) => post.title)].join(' ').toLowerCase();
    return haystack.includes(filters.query.toLowerCase());
  });
  if (summary) {
    const used = allMedia.filter((item) => item.posts.length > 0).length;
    summary.textContent = `共 ${allMedia.length} 個素材 · 圖片 ${allMedia.filter((item) => !isVideoPath(item.path)).length} · 影片 ${allMedia.filter((item) => isVideoPath(item.path)).length} · 使用中 ${used}`;
  }
  if (!visible.length) {
    renderEmpty(grid, Boolean(allMedia.length));
    return;
  }
  grid.className = 'media-library-grid';
  grid.innerHTML = visible.map((item) => {
    const video = isVideoPath(item.path);
    const name = mediaName(item.path);
    const platforms = [...item.platforms].slice(0, 3).map((platformId) => '<span class="platform-chip" data-platform="' + escapeHtml(platformId) + '">' + escapeHtml(platformLabel(platformId)) + '</span>').join('');
    const src = previewMediaSrc(item.path);
    const preview = video
      ? '<video src="' + escapeHtml(src) + '" muted playsinline preload="metadata" aria-label="' + escapeHtml(name) + '"></video>'
      : '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(name) + '" loading="lazy" />';
    const firstPost = item.posts[0];
    return '<article class="media-library-card">'
      + '<div class="media-library-preview" data-type="' + (video ? 'video' : 'image') + '">' + preview + '</div>'
      + '<div class="media-library-body"><strong title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</strong>'
      + '<small>使用於 ' + item.posts.length + ' 篇內容' + (item.latestAt ? ' · ' + escapeHtml(formatDate(item.latestAt)) : '') + '</small>'
      + '<span class="content-platforms">' + (platforms || '<span class="helper">尚未指定平台</span>') + '</span></div>'
      + '<div class="media-library-actions"><button class="btn-text" type="button" data-media-post-id="' + escapeHtml(firstPost.id) + '">查看內容</button></div>'
      + '</article>';
  }).join('');
}

export function initMediaLibrary() {
  $('#mediaSearch')?.addEventListener('input', (event) => {
    filters.query = event.target.value.trim();
    renderMediaLibrary();
  });
  document.querySelectorAll('input[name="mediaType"]').forEach((input) => input.addEventListener('change', () => {
    filters.type = input.value;
    renderMediaLibrary();
  }));
  $('#mediaGrid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-media-post-id]');
    if (button) loadPost(button.dataset.mediaPostId);
  });
}
