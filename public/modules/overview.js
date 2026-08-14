import { $, escapeHtml, formatDate } from './dom.js';
import { state, mediaPathsOf } from './state.js';

function recentTitle(post) {
  return post.title || post.contentTopic || post.godName || post.internalTitle || '未命名內容';
}

export function renderOverview() {
  const postCount = $('#overviewPostCount');
  const scheduledCount = $('#overviewScheduledCount');
  const attentionCount = $('#overviewAttentionCount');
  const recentList = $('#overviewRecentList');
  const schedules = state.schedule || [];
  const attentionStatuses = new Set(['failed', 'retrying']);

  if (postCount) postCount.textContent = String(state.posts.length);
  if (scheduledCount) scheduledCount.textContent = String(schedules.filter((item) => ['scheduled', 'pending'].includes(item.status)).length);
  if (attentionCount) {
    attentionCount.textContent = String(
      schedules.filter((item) => attentionStatuses.has(item.status)).length
      + (state.notifications || []).length,
    );
  }
  if (!recentList) return;

  const recentPosts = state.posts
    .slice()
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))
    .slice(0, 4);

  if (!recentPosts.length) {
    recentList.innerHTML = '<div class="overview-empty"><span aria-hidden="true">✦</span><p>還沒有內容，從「新增內容」開始。</p></div>';
    return;
  }

  recentList.innerHTML = recentPosts.map((post) => {
    const mediaCount = mediaPathsOf(post).length;
    const excerpt = String(post.facebook || post.text || '').trim().slice(0, 48);
    const updatedAt = post.updatedAt || post.createdAt;
    return '<a class="overview-recent-item" href="#/content" data-view-target="drafts" data-route-target="content">'
      + '<span class="overview-recent-icon" aria-hidden="true">' + (mediaCount ? '▧' : '✦') + '</span>'
      + '<span class="overview-recent-body"><strong>' + escapeHtml(recentTitle(post)) + '</strong>'
      + '<small>' + escapeHtml(excerpt || '尚未填寫文案') + '</small></span>'
      + '<time datetime="' + escapeHtml(updatedAt || '') + '">' + (updatedAt ? escapeHtml(formatDate(updatedAt)) : '剛剛') + '</time></a>';
  }).join('');
}
