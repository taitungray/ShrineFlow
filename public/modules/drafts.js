import { $, escapeHtml, formatDate, isVideoPath, setPreviewMessage } from './dom.js';
import { state, mediaPathsOf } from './state.js';
import { renderGenerated } from './editor.js';
import { setActiveView } from './tabs.js';

export function renderPosts() {
  const container = $('#postsList');
  if (!container) return;
  if (!state.posts.length) {
    container.className = 'list-empty';
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📝</span><p>還沒有草稿，點擊上方「產生文案」開始創作吧！</p></div>';
    return;
  }
  container.className = 'record-list';
  container.innerHTML = state.posts.slice(0, 8).map((post) => {
    const firstMedia = mediaPathsOf(post)[0];
    const thumbnail = !firstMedia ? '✦' : isVideoPath(firstMedia)
      ? '<video src="' + escapeHtml(firstMedia) + '" muted playsinline preload="metadata"></video>'
      : '<img src="' + escapeHtml(firstMedia) + '" alt="" />';
    const excerpt = escapeHtml(post.facebook.slice(0, 72)) + (post.facebook.length > 72 ? '…' : '');
    return '<button class="record-card" data-post-id="' + post.id + '" type="button">' +
      '<span class="record-thumb">' + thumbnail + '</span>' +
      '<span class="record-body"><strong>' + escapeHtml(post.godName) + '</strong><small>' + formatDate(post.createdAt) + ' ・ ' + escapeHtml(post.postType) + '</small><span>' + excerpt + '</span></span>' +
      '<span class="record-arrow">›</span></button>';
  }).join('');
  container.querySelectorAll('[data-post-id]').forEach((button) => button.addEventListener('click', () => loadPost(button.dataset.postId)));
}

export async function loadPost(postId) {
  const post = state.posts.find((record) => record.id === postId);
  if (!post) return;
  state.savedPost = post;
  renderGenerated(post);
  setActiveView('review');
  setPreviewMessage('已載入草稿，可以繼續修改。');
  const panel = $('.preview-panel');
  if (panel) window.scrollTo({ top: panel.offsetTop - 24, behavior: 'smooth' });
}
