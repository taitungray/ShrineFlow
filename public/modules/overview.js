import { $, escapeHtml, formatDate } from './dom.js';
import { state, mediaPathsOf, currentClient } from './state.js';
import { platformChipHtml } from './platform-icon.js';
import { buildConnectionStatus } from './connection-status.js';
import { postStatusLabel } from './status.js';

function recentTitle(post) {
  return post.title || post.contentTopic || post.godName || post.internalTitle || '未命名內容';
}

function targetsOf(post) {
  if (Array.isArray(post.targets) && post.targets.length) return post.targets;
  return [{ platformId: post.channel || 'facebook', status: post.status || 'draft' }];
}

function setNavBadge(element, count, type) {
  if (!element) return;
  const value = Number(count) || 0;
  element.textContent = value > 0 ? String(value) : '';
  element.hidden = value <= 0;
  if (value > 0 && type) element.dataset.type = type;
  else delete element.dataset.type;
}

function attentionStatuses() {
  return new Set(['failed', 'retrying']);
}

function publishingAttentionCount() {
  const schedules = state.schedule || [];
  const posts = state.posts || [];
  const failedSchedules = schedules.filter((item) => attentionStatuses().has(item.status));
  const attentionTargetPostIds = new Set(failedSchedules.map((item) => item.postId).filter(Boolean));
  const partialPosts = posts.filter((post) => post.status === 'partial_success' && !attentionTargetPostIds.has(post.id));
  const fbNotConnected = state.facebookStatus && state.facebookStatus.configured && !state.facebookStatus.connected;
  return failedSchedules.length + partialPosts.length + (fbNotConnected ? 1 : 0);
}

function inboxAttentionCount() {
  const sources = state.inbox?.sources || [];
  return sources.reduce((sum, source) => {
    const items = Array.isArray(source.items) ? source.items : [];
    return sum + items.filter((item) => item.unread || item.needsReply).length;
  }, 0);
}

export function refreshNavBadges() {
  setNavBadge($('#navReviewsBadge'), (state.reviewQueue || []).length, 'warning');
  setNavBadge($('#navPublishingBadge'), publishingAttentionCount(), 'danger');
  setNavBadge($('#navInboxBadge'), inboxAttentionCount());
}

function healthHref(key) {
  return key === 'ai' ? '#/settings/gemini' : '#/settings/facebook';
}

function renderOverviewHealth() {
  const root = $('#overviewHealth');
  if (!root) return;
  const view = buildConnectionStatus({
    client: currentClient(),
    config: state.config || {},
    facebookStatus: state.facebookStatus || {},
  });
  root.innerHTML = [view.ai, view.fb].map((item) => (
    '<a class="overview-health-item" data-ready="' + (item.ready ? 'true' : 'false') + '" href="' + healthHref(item.key) + '">'
    + '<span class="overview-health-name">' + escapeHtml(item.label) + '</span>'
    + '<small>' + escapeHtml(item.text) + '</small>'
    + '</a>'
  )).join('');
}

function renderOverviewNext(scheduledItems, posts) {
  const root = $('#overviewNextList');
  if (!root) return;
  const upcoming = scheduledItems
    .filter((item) => item.scheduledAt && !Number.isNaN(new Date(item.scheduledAt).getTime()))
    .filter((item) => new Date(item.scheduledAt).getTime() >= Date.now() - 60 * 1000)
    .sort((left, right) => new Date(left.scheduledAt) - new Date(right.scheduledAt))
    .slice(0, 3);
  if (!upcoming.length) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  root.hidden = false;
  root.innerHTML = '<p class="overview-next-label">接下來</p>'
    + upcoming.map((item) => {
      const post = posts.find((record) => record.id === item.postId) || {};
      return '<a class="overview-next-item" href="#/calendar" data-view-target="schedule" data-route-target="calendar">'
        + platformChipHtml(item.channel)
        + '<strong>' + escapeHtml(recentTitle(post)) + '</strong>'
        + '<time datetime="' + escapeHtml(item.scheduledAt) + '">' + escapeHtml(formatDate(item.scheduledAt)) + '</time>'
        + '</a>';
    }).join('');
}

export function renderOverview() {
  const postCount = $('#overviewPostCount');
  const scheduledCount = $('#overviewScheduledCount');
  const reviewCountEl = $('#overviewReviewCount');
  const attentionCount = $('#overviewAttentionCount');
  const attentionSummaryCard = $('#overviewAttentionSummaryCard');
  const attentionCardSub = $('#overviewAttentionCardSub');
  const attentionList = $('#overviewAttentionList');
  const recentList = $('#overviewRecentList');

  const schedules = state.schedule || [];
  const posts = state.posts || [];
  const reviewQueue = state.reviewQueue || [];

  const failedSchedules = schedules.filter((item) => attentionStatuses().has(item.status));
  const scheduledItems = schedules.filter((item) => ['scheduled', 'pending'].includes(item.status));
  
  const attentionTargetPostIds = new Set(failedSchedules.map((item) => item.postId).filter(Boolean));
  const partialPosts = posts.filter((post) => post.status === 'partial_success' && !attentionTargetPostIds.has(post.id));

  const fbNotConnected = state.facebookStatus && state.facebookStatus.configured && !state.facebookStatus.connected;
  
  const totalAttention = publishingAttentionCount();

  if (postCount) postCount.textContent = String(posts.length);
  if (scheduledCount) scheduledCount.textContent = String(scheduledItems.length);
  if (reviewCountEl) reviewCountEl.textContent = String(reviewQueue.length);
  if (attentionCount) attentionCount.textContent = String(totalAttention);

  if (attentionSummaryCard) {
    attentionSummaryCard.classList.toggle('has-attention', totalAttention > 0);
  }
  if (attentionCardSub) {
    attentionCardSub.textContent = totalAttention > 0 ? `${totalAttention} 項需處理` : '運作正常';
  }

  refreshNavBadges();

  renderOverviewHealth();
  renderOverviewNext(scheduledItems, posts);

  // Render Action Items (待辦與警示)
  if (attentionList) {
    const actionItems = [];

    if (failedSchedules.length > 0) {
      actionItems.push(
        '<a class="overview-attention-item is-danger" href="#/publishing" data-view-target="publishing" data-route-target="publishing">'
        + '<span class="attention-icon" aria-hidden="true">⚠</span>'
        + '<div class="attention-body">'
        + '<strong>' + failedSchedules.length + ' 筆排程發布失敗或等待重試</strong>'
        + '<small>請前往發布紀錄檢視錯誤原因並手動重試</small>'
        + '</div>'
        + '<span class="attention-arrow" aria-hidden="true">→</span>'
        + '</a>'
      );
    }

    if (partialPosts.length > 0) {
      actionItems.push(
        '<a class="overview-attention-item is-warning" href="#/content" data-view-target="drafts" data-route-target="content">'
        + '<span class="attention-icon" aria-hidden="true">◐</span>'
        + '<div class="attention-body">'
        + '<strong>' + partialPosts.length + ' 篇內容部分平台發布未成功</strong>'
        + '<small>請至內容清單檢查各平台發布狀態</small>'
        + '</div>'
        + '<span class="attention-arrow" aria-hidden="true">→</span>'
        + '</a>'
      );
    }

    if (reviewQueue.length > 0) {
      actionItems.push(
        '<a class="overview-attention-item is-info" href="#/reviews" data-view-target="reviews" data-route-target="reviews">'
        + '<span class="attention-icon" aria-hidden="true">✓</span>'
        + '<div class="attention-body">'
        + '<strong>' + reviewQueue.length + ' 篇內容正在等待審核</strong>'
        + '<small>審核通過後方可進行後續排程或發布</small>'
        + '</div>'
        + '<span class="attention-arrow" aria-hidden="true">→</span>'
        + '</a>'
      );
    }

    if (fbNotConnected) {
      actionItems.push(
        '<a class="overview-attention-item is-danger" href="#/settings" data-view-target="settings" data-route-target="settings">'
        + '<span class="attention-icon" aria-hidden="true">⚙</span>'
        + '<div class="attention-body">'
        + '<strong>Facebook 連線異常或 Token 失效</strong>'
        + '<small>請至設定確認 Page Access Token 狀態</small>'
        + '</div>'
        + '<span class="attention-arrow" aria-hidden="true">→</span>'
        + '</a>'
      );
    }

    if (!actionItems.length) {
      attentionList.innerHTML = '<div class="overview-attention-all-good">'
        + '<span class="attention-good-icon" aria-hidden="true">✦</span>'
        + '<div><strong>沒有需要處理的異常</strong><small>連線與發布狀態正常</small></div>'
        + '</div>';
    } else {
      attentionList.innerHTML = actionItems.join('');
    }
  }

  // Render Recent Activity (最近更新)
  if (!recentList) return;

  const recentPosts = posts
    .slice()
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))
    .slice(0, 5);

  if (!recentPosts.length) {
    recentList.innerHTML = '<div class="overview-empty"><span aria-hidden="true">✦</span><p>還沒有內容，從「新增內容」開始。</p></div>';
    return;
  }

  recentList.innerHTML = recentPosts.map((post) => {
    const mediaCount = mediaPathsOf(post).length;
    const excerpt = String(post.facebook || post.text || post.reel || '').trim().slice(0, 42);
    const updatedAt = post.updatedAt || post.createdAt;
    const postStatus = post.status || 'draft';
    const statusText = postStatusLabel(postStatus);
    const targets = targetsOf(post);
    
    const platformChips = targets.map((target) => platformChipHtml(target.platformId || 'facebook')).join('');

    return '<a class="overview-recent-item" href="#/content" data-view-target="drafts" data-route-target="content">'
      + '<span class="overview-recent-icon" aria-hidden="true">' + (mediaCount ? '▧' : '✦') + '</span>'
      + '<span class="overview-recent-body">'
      + '<span class="overview-recent-header">'
      + '<strong>' + escapeHtml(recentTitle(post)) + '</strong>'
      + '<span class="content-status" data-status="' + escapeHtml(postStatus) + '">' + escapeHtml(statusText) + '</span>'
      + '</span>'
      + '<span class="overview-recent-meta">'
      + '<span class="content-platforms">' + platformChips + '</span>'
      + '<small class="overview-recent-excerpt">' + escapeHtml(excerpt || '尚未填寫文案') + '</small>'
      + '</span>'
      + '</span>'
      + '<time datetime="' + escapeHtml(updatedAt || '') + '">' + (updatedAt ? escapeHtml(formatDate(updatedAt)) : '剛剛') + '</time>'
      + '</a>';
  }).join('');
}
