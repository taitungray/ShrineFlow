import { $, escapeHtml, formatDate, showToast } from './dom.js';
import { api } from './api.js';
import { clientQuery, currentClient, hasPermission, state, PLATFORM_NAMES } from './state.js';
import { renderBestTimes } from './best-times.js';
import { extractAllMetrics, metricDisplayValue } from './insights-metrics.js';
import { platformChipHtml, platformPillHtml } from './platform-icon.js';
import { setActiveView } from './tabs.js';

function targetsOf(post) {
  return Array.isArray(post.targets) && post.targets.length
    ? post.targets
    : [{ platformId: post.channel || 'facebook', status: post.status || 'draft' }];
}

function platformIds() {
  return state.platforms.length ? state.platforms.map((platform) => platform.id) : Object.keys(PLATFORM_NAMES);
}

const STATUS_LABELS = {
  draft: '草稿',
  review: '待審',
  approved: '已核准',
  scheduled: '已排程',
  pending: '待處理',
  publishing: '發布中',
  published: '已發布',
  failed: '失敗',
  retrying: '重試中',
  cancelled: '已取消',
  archived: '已封存',
  hidden: '已隱藏',
  partial_success: '部分成功',
};

const METRIC_LABELS = {
  page_post_engagements: '貼文互動',
  page_views_total: '專頁瀏覽',
  page_follows: '追蹤數',
  page_daily_follows: '新增追蹤',
  page_daily_follows_unique: '新增追蹤（不重複）',
  page_daily_unfollows_unique: '取消追蹤',
  page_impressions: '曝光',
  page_impressions_paid: '付費曝光',
  page_impressions_viral: '病毒曝光',
  page_impressions_nonviral: '非病毒曝光',
  page_media_view: '媒體觀看',
  page_total_media_view_unique: '媒體觀看人數',
  page_posts_impressions: '貼文曝光',
  page_posts_impressions_unique: '貼文觸及',
  page_posts_impressions_organic_unique: '自然觸及',
  page_total_actions: '專頁行動',
  page_actions_post_reactions_like_total: '讚',
  page_actions_post_reactions_love_total: '大心',
  page_actions_post_reactions_wow_total: '哇',
  page_actions_post_reactions_haha_total: '哈',
  page_actions_post_reactions_sorry_total: '嗚',
  page_actions_post_reactions_anger_total: '怒',
  page_video_views: '影片觀看',
  page_video_views_organic: '影片自然觀看',
  page_video_complete_views_30s: '影片看滿 30 秒',
  page_fans: '粉絲數',
  page_fan_adds: '新增粉絲',
  page_fan_removes: '取消追蹤粉絲',
  post_media_view: '媒體觀看',
  post_total_media_view_unique: '觀看人數',
  post_clicks: '點擊',
  post_engaged_users: '互動人數',
  post_impressions: '曝光',
  post_impressions_organic: '自然曝光',
  post_impressions_paid: '付費曝光',
  post_impressions_fan: '粉絲曝光',
  post_impressions_viral: '病毒曝光',
  post_impressions_nonviral: '非病毒曝光',
  post_reactions_like_total: '讚',
  post_reactions_love_total: '大心',
  post_reactions_wow_total: '哇',
  post_reactions_haha_total: '哈',
  post_reactions_sorry_total: '嗚',
  post_reactions_anger_total: '怒',
  post_activity_by_action_type: '互動類型',
  post_video_views: '影片觀看',
  post_video_views_organic: '影片自然觀看',
  post_video_complete_views_organic: '影片完播',
  likes: '讚',
  comments: '留言',
  shares: '分享',
  reactions: '心情',
  views: '觀看',
  reach: '觸及',
  saves: '收藏',
  saved: '收藏',
  replies: '回覆',
  profile_links_taps: '個人檔連結點擊',
  accounts_engaged: '互動帳號',
  total_interactions: '總互動',
  follower_count: '追蹤數',
  followers_count: '追蹤數',
  follows_and_unfollows: '追蹤增減',
  website_clicks: '網站點擊',
  profile_views: '個人檔瀏覽',
  follows: '因此追蹤',
  profile_visits: '個人檔造訪',
  navigation: '導覽',
  reposts: '轉發',
  quotes: '引用',
  clicks: '點擊',
};

const ACCOUNT_METRIC_GROUPS = {
  facebook: [
    { id: 'audience', title: '粉絲與追蹤', names: ['page_follows', 'page_fans', 'page_daily_follows', 'page_daily_follows_unique', 'page_daily_unfollows_unique', 'page_fan_adds', 'page_fan_removes'] },
    { id: 'reach', title: '曝光與觸及', names: ['page_impressions', 'page_impressions_paid', 'page_impressions_viral', 'page_impressions_nonviral', 'page_posts_impressions', 'page_posts_impressions_unique', 'page_posts_impressions_organic_unique'] },
    { id: 'engagement', title: '互動與心情', names: ['page_post_engagements', 'page_total_actions', 'page_actions_post_reactions_like_total', 'page_actions_post_reactions_love_total', 'page_actions_post_reactions_wow_total', 'page_actions_post_reactions_haha_total', 'page_actions_post_reactions_sorry_total', 'page_actions_post_reactions_anger_total'] },
    { id: 'media', title: '媒體與影片', names: ['page_media_view', 'page_total_media_view_unique', 'page_video_views', 'page_video_views_organic', 'page_video_complete_views_30s', 'page_views_total'] },
  ],
  instagram: [
    { id: 'reach', title: '觀看與觸及', names: ['views', 'reach'] },
    { id: 'engagement', title: '互動', names: ['likes', 'comments', 'shares', 'saves', 'replies', 'total_interactions', 'accounts_engaged'] },
    { id: 'profile', title: '個人檔', names: ['profile_views', 'profile_links_taps', 'website_clicks'] },
    { id: 'audience', title: '追蹤', names: ['follower_count', 'follows_and_unfollows'] },
  ],
  threads: [
    { id: 'reach', title: '觀看', names: ['views'] },
    { id: 'engagement', title: '互動', names: ['likes', 'replies', 'reposts', 'quotes', 'shares', 'clicks'] },
    { id: 'audience', title: '追蹤', names: ['followers_count'] },
  ],
};

const POST_METRIC_GROUPS = {
  facebook: [
    { id: 'reach', title: '曝光', names: ['post_impressions', 'post_impressions_organic', 'post_impressions_paid', 'post_impressions_fan', 'post_impressions_viral', 'post_impressions_nonviral'] },
    { id: 'engagement', title: '互動', names: ['likes', 'comments', 'shares', 'reactions', 'post_clicks', 'post_engaged_users', 'post_activity_by_action_type', 'post_reactions_like_total', 'post_reactions_love_total', 'post_reactions_wow_total', 'post_reactions_haha_total', 'post_reactions_sorry_total', 'post_reactions_anger_total'] },
    { id: 'media', title: '媒體與影片', names: ['post_media_view', 'post_total_media_view_unique', 'post_video_views', 'post_video_views_organic', 'post_video_complete_views_organic'] },
  ],
  instagram: [
    { id: 'reach', title: '觀看與觸及', names: ['views', 'reach'] },
    { id: 'engagement', title: '互動', names: ['likes', 'comments', 'shares', 'saved', 'total_interactions', 'follows'] },
    { id: 'profile', title: '個人檔', names: ['profile_visits', 'navigation'] },
  ],
  threads: [
    { id: 'reach', title: '觀看', names: ['views'] },
    { id: 'engagement', title: '互動', names: ['likes', 'replies', 'reposts', 'quotes', 'shares', 'clicks'] },
  ],
};

let insightsLoadToken = 0;
let insightsLoading = false;
let aiAnalysisLoading = false;
let currentLeaderboardSort = 'engagement';

function formatMetricNumber(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value)
      .map(([key, inner]) => (METRIC_LABELS[key] || key) + ' ' + formatMetricNumber(inner))
      .join('／');
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Intl.NumberFormat('zh-TW').format(numeric) : String(value);
}

function formatShortDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getMonth() + 1).padStart(2, '0') + '/' + String(date.getDate()).padStart(2, '0');
}

function metricHasDisplayValue(value) {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function dailyBreakdown(metric) {
  const values = Array.isArray(metric?.values) ? metric.values : [];
  const days = values
    .map((item) => {
      const day = formatShortDay(item?.end_time || item?.endTime || '');
      if (!day || !metricHasDisplayValue(item?.value)) return '';
      return '<span><time>' + escapeHtml(day) + '</time> ' + escapeHtml(formatMetricNumber(item.value)) + '</span>';
    })
    .filter(Boolean);
  return days.length > 1 ? '<div class="insights-metric-days">' + days.join('') + '</div>' : '';
}

function renderMetricCard(metric) {
  const value = metricDisplayValue(metric);
  const label = METRIC_LABELS[metric.name] || metric.title || metric.name || '指標';
  const display = metricHasDisplayValue(value) ? formatMetricNumber(value) : '—';
  const period = metric.period ? '<small>' + escapeHtml(metric.period) + '</small>' : '';
  return '<div class="insights-metric"><span>' + escapeHtml(String(label)) + period + '</span><strong>' + escapeHtml(display) + '</strong>' + dailyBreakdown(metric) + '</div>';
}

function groupedMetricSections(source, groupsByPlatform) {
  const metrics = Array.isArray(source?.data) ? source.data : [];
  if (!metrics.length) {
    return '<p class="helper">API 已回應，但這段期間沒有可列出的指標名稱。權限不足或粉專沒有對應 Insights 時，Meta 會回空資料。</p>';
  }
  const groups = groupsByPlatform[source.platformId] || [];
  const used = new Set();
  const sections = groups.map((group) => {
    const items = group.names
      .map((name) => metrics.find((metric) => metric.name === name))
      .filter(Boolean);
    items.forEach((metric) => used.add(metric.name));
    if (!items.length) return '';
    return '<div class="insights-metric-group"><h4>' + escapeHtml(group.title) + '</h4><div class="insights-metric-grid">'
      + items.map(renderMetricCard).join('') + '</div></div>';
  }).filter(Boolean);
  const leftover = metrics.filter((metric) => !used.has(metric.name));
  if (leftover.length) {
    sections.push('<div class="insights-metric-group"><h4>其他指標</h4><div class="insights-metric-grid">'
      + leftover.map(renderMetricCard).join('') + '</div></div>');
  }
  return sections.join('') || '<p class="helper">有回傳資料，但無法歸類顯示。</p>';
}

function skippedMetricsNote(source) {
  const skipped = Array.isArray(source?.skippedMetrics) ? source.skippedMetrics : [];
  if (!skipped.length) return '';
  return '<p class="helper">已略過無效指標：' + skipped.map((name) => escapeHtml(METRIC_LABELS[name] || name)).join('、') + '。</p>';
}

function sourceStatusText(source) {
  if (!source) return '尚未同步真實成效';
  if (source.status === 'synced') {
    return '已同步 ' + (source.fetchedAt ? formatDate(source.fetchedAt) : '最新資料');
  }
  if (source.status === 'cached') {
    const when = source.fetchedAt ? formatDate(source.fetchedAt) : '';
    if (source.cache?.reason === 'fresh') {
      return '顯示已保存資料 ' + when + '（額度保護，未重打 Meta）';
    }
    if (source.cache?.reason === 'deferred') {
      return '沿用已保存資料 ' + when + '（本次額度預算已用完）';
    }
    if (source.cache?.reason === 'invalid_id') {
      return '貼文 ID 無效，已暫停重試 ' + when;
    }
    return '顯示已保存資料 ' + when + '（非即時）';
  }
  if (source.status === 'error') {
    return '同步失敗：' + (source.error?.message || '請檢查平台權限與 Token');
  }
  if (source.status === 'not_available') {
    return source.error?.message || '此 target 尚無可用的貼文 Insights。';
  }
  if (source.status === 'not_configured') {
    return source.error?.message || '尚未設定此平台 Insights 憑證';
  }
  return '尚未設定此平台 Insights 憑證';
}

function rangeText(source) {
  const since = source?.range?.since;
  const until = source?.range?.until;
  if (since && until) return `${formatShortDay(since)} ～ ${formatShortDay(until)}`;
  return '帳號區間 ' + String(state.insightsRange || 7) + ' 日';
}

function insightsQuery(extra = '', { liveRefresh = false } = {}) {
  const platform = state.insightsPlatform || 'facebook';
  const days = Number(state.insightsRange || 7);
  const now = new Date();
  const until = Math.floor(now.getTime() / 1000);
  const since = until - days * 86400;
  const base = '?platform=' + encodeURIComponent(platform)
    + '&since=' + encodeURIComponent(String(since))
    + '&until=' + encodeURIComponent(String(until));
  const query = extra ? base + '&' + extra.replace(/^\?/, '') : base;
  return liveRefresh ? query + '&refresh=1' : query;
}

function cacheKeyMatches(record) {
  if (!record) return false;
  return record.clientId === (state.currentClientId || '')
    && record.platformId === (state.insightsPlatform || 'facebook')
    && Number(record.rangeDays || state.insightsRange) === Number(state.insightsRange || 7);
}

function mergeAccountSources(accountInsights) {
  const incoming = Array.isArray(accountInsights?.sources) ? accountInsights.sources : [];
  const platform = state.insightsPlatform || 'facebook';
  const others = (state.insights?.sources || []).filter((item) => item.platformId !== platform);
  return {
    ...(state.insights || {}),
    status: accountInsights?.status || state.insights?.status || 'unavailable',
    clientId: state.currentClientId || accountInsights?.clientId || '',
    fetchedAt: accountInsights?.fetchedAt || new Date().toISOString(),
    sources: [...others, ...incoming],
  };
}

async function loadInsightsDetail({ refreshAccount = true, liveRefresh = false } = {}) {
  const token = ++insightsLoadToken;
  insightsLoading = true;
  const platform = state.insightsPlatform || 'facebook';
  const refreshButton = $('#btnRefreshInsights');
  if (refreshButton) refreshButton.disabled = true;

  try {
    const accountPath = clientQuery('/api/insights' + insightsQuery('?scope=account', { liveRefresh }));
    const postsPath = clientQuery('/api/insights' + insightsQuery('?scope=posts', { liveRefresh }) + '&limit=50');
    const bestTimesPath = clientQuery('/api/insights/best-times?platform=' + encodeURIComponent(platform));
    const repurposePath = clientQuery('/api/insights/repurpose?platform=' + encodeURIComponent(platform));
    const [accountInsights, postInsights, bestTimes, repurposeCandidates] = await Promise.all([
      refreshAccount
        ? api(accountPath).catch(() => ({ status: 'unavailable', sources: [] }))
        : Promise.resolve(state.insights || { status: 'unavailable', sources: [] }),
      api(postsPath).catch(() => ({ status: 'unavailable', sources: [] })),
      api(bestTimesPath).catch(() => ({ status: 'unavailable', slots: [] })),
      api(repurposePath).catch(() => ({ status: 'insufficient_data', candidates: [] })),
    ]);

    if (token !== insightsLoadToken) return;
    if (refreshAccount) state.insights = mergeAccountSources(accountInsights);
    state.insightsPosts = {
      ...postInsights,
      platformId: platform,
      clientId: state.currentClientId || postInsights.clientId || '',
      rangeDays: Number(state.insightsRange || 7),
    };
    state.bestTimes = bestTimes;
    state.repurposeCandidates = repurposeCandidates;
    renderInsights();
  } catch (error) {
    if (token !== insightsLoadToken) return;
    const notice = $('#insightsSourceNotice');
    if (notice) notice.innerHTML = '<strong>同步失敗</strong><span>' + escapeHtml(error.message) + '</span>';
  } finally {
    if (token === insightsLoadToken) insightsLoading = false;
    const button = $('#btnRefreshInsights');
    if (button) button.disabled = false;
  }
}

function ensureInsightsDetail() {
  if (insightsLoading) return;
  if (cacheKeyMatches(state.insightsPosts)) return;
  loadInsightsDetail({ refreshAccount: true });
}

async function createRepurposeDraft(button) {
  const postId = button.dataset.repurposePost;
  if (!postId || button.disabled) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = '建立中…';
  try {
    const created = await api('/api/posts/' + encodeURIComponent(postId) + '/repurpose', { method: 'POST' });
    state.posts = [created, ...(state.posts || [])];
    button.textContent = '已建立再製草稿';
    button.dataset.created = 'true';
    showToast('✨ 已建立再製草稿，原貼文保持不變。', 'success');
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    showToast(error.message || '建立再製草稿失敗。', 'error');
  }
}

function renderPlatformTabs() {
  const tabs = $('#insightsPlatformTabs');
  if (!tabs) return;
  const available = platformIds();
  if (!available.includes(state.insightsPlatform)) state.insightsPlatform = available[0] || 'facebook';
  tabs.innerHTML = available.map((platformId) => {
    return platformPillHtml(platformId, {
      name: 'insightsPlatform',
      checked: platformId === state.insightsPlatform,
    });
  }).join('');
}

function renderRepurpose() {
  const container = $('#repurposeCard');
  if (!container) return;
  const result = state.repurposeCandidates || { status: 'insufficient_data', candidates: [] };
  const platform = state.insightsPlatform || 'facebook';
  const candidates = (Array.isArray(result.candidates) ? result.candidates : [])
    .filter((candidate) => !candidate.platformId || candidate.platformId === platform);
  const canCreate = hasPermission('content.create');
  const notice = result.status === 'ready' && candidates.length
    ? '以下只根據已保存的貼文 Insights 排名；沒有真實貼文成效的內容不會出現在建議中。'
    : '目前沒有同時具備已發布 target 與已保存貼文 Insights 的內容。';
  const rows = candidates.length
    ? '<div class="repurpose-candidate-grid">' + candidates.map((candidate) => (
      '<article class="repurpose-candidate-card">'
      + '<div class="repurpose-candidate-heading"><div><span class="section-tag">#' + escapeHtml(String(candidate.rank || '—')) + '</span><h4>' + escapeHtml(candidate.postTitle || candidate.postId || '未命名內容') + '</h4></div>'
      + '<strong>' + escapeHtml(String(candidate.metric?.value ?? '—')) + '</strong></div>'
      + '<p class="repurpose-candidate-meta">依 ' + escapeHtml(candidate.metric?.name || '已保存指標') + ' 排名 · 發布於 ' + escapeHtml(candidate.publishedAt ? formatDate(candidate.publishedAt) : '未知') + '</p>'
      + (canCreate
        ? '<button class="btn-secondary" type="button" data-repurpose-post="' + escapeHtml(candidate.postId) + '">🔁 建立再製草稿</button>'
        : '<span class="helper">需要內容建立權限才能建立再製草稿。</span>')
      + '</article>'
    )).join('') + '</div>'
    : '<p class="helper">' + notice + '</p>';
  container.innerHTML = '<div class="repurpose-heading"><div><span class="section-tag">REPURPOSE CANDIDATES</span><h3>🔁 已發布內容再製</h3></div><span class="badge" data-status="' + escapeHtml(result.status || 'insufficient_data') + '">' + escapeHtml(result.status === 'ready' && candidates.length ? '有真實成效' : '資料充足度不足') + '</span></div>'
    + '<p class="helper">' + notice + '</p>' + rows;
  container.querySelectorAll('[data-repurpose-post]').forEach((button) => {
    button.addEventListener('click', () => createRepurposeDraft(button));
  });
}

function postTitle(post) {
  return post.contentTopic || post.godName || post.id || '未命名內容';
}

function postPreview(post, target) {
  const text = String(target?.overrideText || post.generatedCopy || post.caption || post.content || '').trim();
  if (!text) return '沒有可預覽的文案。';
  return text.length > 140 ? text.slice(0, 140) + '…' : text;
}

/* ==========================================================================
   🔥 熱門內容表現排行榜 (Leaderboard)
   ========================================================================== */
function renderLeaderboard(platformId, platformEntries) {
  const container = $('#leaderboardList');
  if (!container) return;

  const published = platformEntries
    .filter((item) => item.target.status === 'published')
    .map(({ post, target }) => {
      const sources = Array.isArray(state.insightsPosts?.sources) ? state.insightsPosts.sources : [];
      const source = sources.find((item) => item.targetId === target.id || item.externalId === target.externalId);
      const metrics = extractAllMetrics(source);
      return {
        post,
        target,
        source,
        metrics,
        publishedAt: target.publishedAt || post.updatedAt || post.createdAt || 0,
      };
    });

  if (!published.length) {
    container.innerHTML = '<div class="leaderboard-empty"><p class="helper">目前這個平台尚未發布任何內容。完成發布後，熱門內容排行與成效數據將在此自動計算！</p></div>';
    return;
  }

  // 排序
  if (currentLeaderboardSort === 'engagement') {
    published.sort((a, b) => b.metrics.total - a.metrics.total || new Date(b.publishedAt) - new Date(a.publishedAt));
  } else if (currentLeaderboardSort === 'reach') {
    published.sort((a, b) => b.metrics.reach - a.metrics.reach || new Date(b.publishedAt) - new Date(a.publishedAt));
  } else {
    published.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  const rankBadges = ['🥇', '🥈', '🥉'];

  container.innerHTML = published.map((item, index) => {
    const rankLabel = rankBadges[index] || `#${index + 1}`;
    const rankClass = index < 3 ? `rank-top rank-${index + 1}` : 'rank-normal';
    const rankName = `第 ${index + 1} 名`;
    const { post, target, metrics } = item;
    const canCreate = hasPermission('content.create');
    const excerpt = postPreview(post, target);
    const showExcerpt = excerpt && excerpt !== '沒有可預覽的文案。';
    const publishedLabel = formatDate(item.publishedAt);

    return `<article class="leaderboard-item ${rankClass}">
      <div class="leaderboard-rank-badge" aria-label="${escapeHtml(rankName)}">${escapeHtml(rankLabel)}</div>
      <div class="leaderboard-item-main">
        <div class="leaderboard-title-row">
          ${platformChipHtml(target.platformId)}
          <h4>${escapeHtml(postTitle(post))}</h4>
        </div>
        <p class="leaderboard-meta">${escapeHtml(publishedLabel)}</p>
        ${showExcerpt ? `<p class="leaderboard-excerpt">${escapeHtml(excerpt)}</p>` : ''}
      </div>
      <dl class="leaderboard-stats">
        <div class="leaderboard-stat is-hero">
          <dt>互動</dt>
          <dd>${escapeHtml(formatMetricNumber(metrics.total))}</dd>
        </div>
        <div class="leaderboard-stat">
          <dt>觸及</dt>
          <dd>${escapeHtml(formatMetricNumber(metrics.reach))}</dd>
        </div>
        <div class="leaderboard-stat is-detail">
          <dt>讚／留言／分享</dt>
          <dd>${escapeHtml(formatMetricNumber(metrics.likes))} · ${escapeHtml(formatMetricNumber(metrics.comments))} · ${escapeHtml(formatMetricNumber(metrics.shares))}</dd>
        </div>
      </dl>
      <div class="leaderboard-item-actions">
        ${canCreate ? `<button type="button" class="btn-secondary" data-repurpose-post="${escapeHtml(post.id)}">建立再製</button>` : ''}
      </div>
    </article>`;
  }).join('');

  container.querySelectorAll('[data-repurpose-post]').forEach((button) => {
    button.addEventListener('click', () => createRepurposeDraft(button));
  });
}

/* ==========================================================================
   ✨ AI 社群成效顧問 (AI Insights Advisor)
   ========================================================================== */
export async function triggerAiAnalysis() {
  if (aiAnalysisLoading) return;
  aiAnalysisLoading = true;
  const container = $('#aiInsightsContent');
  const triggerBtn = $('#btnTriggerAiAnalysis');
  const topBtn = $('#btnRunAiInsights');
  if (triggerBtn) triggerBtn.disabled = true;
  if (topBtn) topBtn.disabled = true;

  if (container) {
    container.innerHTML = `<div class="ai-insights-loading">
      <div class="ai-spinner"></div>
      <p>✨ <strong>AI 顧問分析中…</strong><br><span class="helper">正在深入分析近期貼文表現、受眾互動偏好與最佳主題模式，請稍候幾秒鐘。</span></p>
    </div>`;
  }

  try {
    const platform = state.insightsPlatform || 'all';
    const payload = {
      clientId: state.currentClientId || '',
      platform,
    };
    const result = await api('/api/insights/ai-analysis', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.aiInsightsResult = result;
    renderAiInsightsAdvisor();
    showToast('✨ AI 社群成效分析與下一步靈感已產生！', 'success');
  } catch (error) {
    if (container) {
      container.innerHTML = `<div class="ai-insights-error">
        <p class="error-text">⚠️ AI 分析產生失敗：${escapeHtml(error.message)}</p>
        <button type="button" id="btnRetryAiAnalysis" class="btn-secondary">重新嘗試</button>
      </div>`;
      $('#btnRetryAiAnalysis')?.addEventListener('click', triggerAiAnalysis);
    }
    showToast(error.message || 'AI 分析失敗', 'error');
  } finally {
    aiAnalysisLoading = false;
    if (triggerBtn) triggerBtn.disabled = false;
    if (topBtn) topBtn.disabled = false;
  }
}

function applyIdeaToComposer(idea) {
  setActiveView('create');
  const topicInput = $('#contentTopic');
  const notesInput = $('#extraNotes');
  if (topicInput) topicInput.value = idea.topic || idea.title || '';
  if (notesInput) {
    notesInput.value = `【建議形式】：${idea.format || '圖文'}\n【發想指引】：${idea.prompt || ''}\n【推薦理由】：${idea.reason || ''}`;
  }
  topicInput?.focus?.();
  showToast(`✨ 已將「${idea.title || idea.topic}」發文靈感帶入編輯器！`, 'success');
}

function renderAiInsightsAdvisor() {
  const container = $('#aiInsightsContent');
  if (!container) return;

  const result = state.aiInsightsResult;
  if (!result) {
    container.innerHTML = `<div class="ai-insights-placeholder">
      <p class="helper">點擊上方「✨ 產生 AI 分析與靈感」，AI 將自動分析現有已發布貼文與互動數據，提煉受眾喜好並提供 3 個可直接採用的下一步發文靈感。</p>
    </div>`;
    return;
  }

  const themesHtml = Array.isArray(result.topThemes) && result.topThemes.length
    ? `<div class="ai-themes-grid">${result.topThemes.map((t) => `
        <div class="ai-theme-pill">
          <strong>🔥 ${escapeHtml(t.theme)}</strong>
          <span>${escapeHtml(t.whyItWorked)}</span>
        </div>`).join('')}</div>`
    : '';

  const tipsHtml = Array.isArray(result.actionableTips) && result.actionableTips.length
    ? `<div class="ai-tips-section">
        <h4>💡 發文經營與互動建議</h4>
        <ul class="ai-tips-list">
          ${result.actionableTips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const ideasHtml = Array.isArray(result.nextPostIdeas) && result.nextPostIdeas.length
    ? `<div class="ai-ideas-section">
        <h4>📝 推薦下一步發文靈感（點擊可直接建立草稿）</h4>
        <div class="ai-ideas-grid">
          ${result.nextPostIdeas.map((idea, i) => `
            <article class="ai-idea-card">
              <div class="ai-idea-header">
                <span class="ai-idea-format">【${escapeHtml(idea.format || '圖文')}】</span>
                <h5>${escapeHtml(idea.title || idea.topic)}</h5>
              </div>
              <p class="ai-idea-reason"><strong>推薦原因：</strong>${escapeHtml(idea.reason)}</p>
              <p class="ai-idea-prompt"><strong>發想指引：</strong>${escapeHtml(idea.prompt)}</p>
              <button type="button" class="primary-button btn-apply-idea" data-idea-index="${i}">📝 採用此靈感建立草稿</button>
            </article>
          `).join('')}
        </div>
      </div>`
    : '';

  container.innerHTML = `
    <div class="ai-insights-result-wrap">
      <div class="ai-summary-banner">
        <span class="ai-badge">✨ 顧問總結</span>
        <p>${escapeHtml(result.summary || '成效分析完成。')}</p>
      </div>
      ${themesHtml}
      ${tipsHtml}
      ${ideasHtml}
    </div>
  `;

  container.querySelectorAll('.btn-apply-idea').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.ideaIndex);
      const idea = result.nextPostIdeas?.[idx];
      if (idea) applyIdeaToComposer(idea);
    });
  });
}

/* ==========================================================================
   平台原始 API 技術指標 (折疊收納)
   ========================================================================== */
function accountCards(platformId) {
  const client = currentClient();
  const accounts = (client?.accounts || []).filter((account) => account.platformId === platformId);
  const sources = (state.insights?.sources || []).filter((source) => source.platformId === platformId);
  if (!accounts.length && !sources.length) {
    return '<p class="helper">尚未綁定帳號。到平台連線完成授權後才能拉真實成效。</p><a class="btn-text" href="#/platforms" data-view-target="platforms" data-route-target="platforms">前往平台連線 →</a>';
  }
  const rows = (sources.length ? sources : accounts.map((account) => ({
    accountId: account.id,
    accountName: account.name || account.id,
    platformId,
    status: account.configured === false || account.enabled === false ? 'not_configured' : 'unavailable',
    data: [],
  }))).map((source) => {
    const live = ['synced', 'cached'].includes(source.status);
    return '<article class="insights-account-card" data-status="' + escapeHtml(source.status || 'unavailable') + '">'
      + '<div class="insights-account-heading"><div><h4>' + escapeHtml(source.accountName || source.accountId || '未命名帳號') + '</h4>'
      + '<small>' + escapeHtml(source.accountId || '') + (source.source ? ' · ' + escapeHtml(source.source) : '') + '</small></div>'
      + '<p class="insights-external-stats" data-status="' + escapeHtml(source.status || 'unavailable') + '">' + escapeHtml(sourceStatusText(source)) + '</p></div>'
      + '<p class="insights-account-range">' + escapeHtml(rangeText(source)) + '</p>'
      + (source.error?.message && source.status !== 'synced' ? '<p class="helper">' + escapeHtml(source.error.message) + '</p>' : '')
      + (live ? groupedMetricSections(source, ACCOUNT_METRIC_GROUPS) + skippedMetricsNote(source) : '')
      + '</article>';
  });
  return rows.join('');
}

function renderPublishedPosts(platformId, targets) {
  const sources = Array.isArray(state.insightsPosts?.sources) ? state.insightsPosts.sources : [];
  const published = targets
    .filter((item) => item.target.status === 'published')
    .sort((left, right) => new Date(right.target.publishedAt || right.post.updatedAt || 0) - new Date(left.target.publishedAt || left.post.updatedAt || 0));
  if (!published.length) {
    return '<p class="helper">這個平台還沒有已發布內容，因此沒有貼文 Insights 可對照。</p>';
  }
  const loading = insightsLoading && !cacheKeyMatches(state.insightsPosts);
  return '<div class="insights-post-list">' + published.map(({ post, target }) => {
    const source = sources.find((item) => item.targetId === target.id || item.externalId === target.externalId);
    const live = ['synced', 'cached'].includes(source?.status);
    return '<article class="insights-post-card">'
      + '<div class="insights-post-heading"><div><h4>' + escapeHtml(postTitle(post)) + '</h4>'
      + '<small>' + escapeHtml(STATUS_LABELS[target.status] || target.status)
      + ' · ' + escapeHtml(target.publishedAt ? formatDate(target.publishedAt) : '發布時間未知')
      + (target.accountId ? ' · ' + escapeHtml(target.accountId) : '')
      + (target.externalId ? ' · 平台 ID ' + escapeHtml(target.externalId) : ' · 沒有平台貼文 ID')
      + '</small></div>'
      + '<p class="insights-external-stats" data-status="' + escapeHtml(source?.status || (loading ? 'pending' : 'unavailable')) + '">'
      + escapeHtml(source ? sourceStatusText(source) : (loading ? '正在同步貼文成效…' : '尚未同步這則貼文成效'))
      + '</p></div>'
      + '<p class="insights-post-excerpt">' + escapeHtml(postPreview(post, target)) + '</p>'
      + (live ? groupedMetricSections(source, POST_METRIC_GROUPS) + skippedMetricsNote(source) : '')
      + (!live && source?.error?.message ? '<p class="helper">' + escapeHtml(source.error.message) + '</p>' : '')
      + '</article>';
  }).join('') + '</div>';
}

/* ==========================================================================
   主渲染函式與事件監聽
   ========================================================================== */
export function renderInsights() {
  renderPlatformTabs();
  renderRepurpose();
  renderBestTimes();
  renderAiInsightsAdvisor();

  const summary = $('#insightsOperationalSummary');
  const detail = $('#insightsPlatformDetail');
  const notice = $('#insightsSourceNotice');
  if (!summary) return;

  const platformId = state.insightsPlatform || 'facebook';
  const rangeInput = document.querySelector('#insightsRangeFilter input[value="' + String(state.insightsRange || 7) + '"]');
  if (rangeInput) rangeInput.checked = true;

  const posts = state.posts || [];
  const platformEntries = posts.flatMap((post) => targetsOf(post).map((target) => ({ post, target })))
    .filter((item) => item.target.platformId === platformId);
  const targets = platformEntries.map((item) => item.target);
  const published = targets.filter((target) => target.status === 'published').length;
  const sources = (state.insights?.sources || []).filter((source) => source.platformId === platformId);
  const liveSource = sources.find((source) => ['synced', 'cached'].includes(source.status));

  // 計算累積互動
  const postSources = Array.isArray(state.insightsPosts?.sources) ? state.insightsPosts.sources : [];
  let totalInteractionsCount = 0;
  let highestInteractions = 0;
  let topPostTitle = '—';

  platformEntries.forEach(({ post, target }) => {
    if (target.status === 'published') {
      const s = postSources.find((item) => item.targetId === target.id || item.externalId === target.externalId);
      const m = extractAllMetrics(s);
      totalInteractionsCount += m.total;
      if (m.total > highestInteractions) {
        highestInteractions = m.total;
        topPostTitle = postTitle(post);
      }
    }
  });

  // 渲染排行榜
  renderLeaderboard(platformId, platformEntries);

  // 渲染核心摘要卡片
  summary.innerHTML = [
    ['已發布篇數', `${published} 篇`, '此平台成功發布內容'],
    ['累積社群互動', totalInteractionsCount ? formatMetricNumber(totalInteractionsCount) : '—', '讚、留言與分享總計'],
    ['熱門貼文亮點', highestInteractions ? `${highestInteractions} 互動` : (published ? '最高成效' : '尚未發布'), topPostTitle !== '—' ? (topPostTitle.length > 12 ? topPostTitle.slice(0, 12) + '…' : topPostTitle) : '暫無資料'],
    ['帳號連線狀態', liveSource ? '已連線' : '尚未同步', liveSource ? rangeText(liveSource) : '可至「平台連線」設定'],
  ].map(([label, value, noteText]) => `<div class="module-summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(noteText)}</small></div>`).join('');

  if (notice) {
    const liveCount = sources.filter((source) => ['synced', 'cached'].includes(source.status)).length;
    const deferred = postSources.some((source) => source.cache?.reason === 'deferred');
    const freshOnly = postSources.length > 0 && postSources.every((source) => source.cache?.reason === 'fresh' || source.cache?.reason === 'invalid_id');
    notice.innerHTML = `<strong>✨ 內容表現數據</strong><span>${
      deferred
        ? '為避免打滿 Meta 額度，本次只同步最新幾則貼文。其餘沿用已保存資料；要重拉請按「重新同步」。'
        : freshOnly
          ? '目前顯示已保存成效（6 小時內不重打 Meta）。要最新數字再按「重新同步」。'
          : liveCount
            ? '已同步平台真實數據，結合 AI 為您提煉最佳發布策略。'
            : '目前顯示本機發布歷史；連線平台憑證後可自動同步即時互動數據。'
    }</span>`;
  }

  // 原始技術指標 (收納於 details 內)
  if (detail) {
    detail.innerHTML = '<fieldset class="form-group-card insights-section"><legend class="group-title">帳號成效與粉絲指標</legend>'
      + '<p class="helper">粉絲、曝光、互動依帳號區間彙總。空值顯示為 —，不會改成 0 來假裝有資料。</p>'
      + accountCards(platformId)
      + '</fieldset>'
      + '<fieldset class="form-group-card insights-section"><legend class="group-title">各篇貼文原始指標</legend>'
      + '<p class="helper">每一則已發布 target 分開列。開頁先讀已保存資料；6 小時內不重打 Meta。重新同步每次最多拉最新 8 則。</p>'
      + renderPublishedPosts(platformId, platformEntries)
      + '</fieldset>';
  }

  ensureInsightsDetail();
}

export function initInsightsListeners() {
  $('#insightsPlatformTabs')?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="insightsPlatform"]');
    if (!input) return;
    state.insightsPlatform = input.value;
    renderInsights();
    loadInsightsDetail({ refreshAccount: true });
  });

  $('#insightsRangeFilter')?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="insightsRange"]');
    if (!input) return;
    state.insightsRange = Number(input.value) || 7;
    state.insightsPosts = null;
    loadInsightsDetail({ refreshAccount: true });
  });

  $('#btnRefreshInsights')?.addEventListener('click', () => {
    state.insightsPosts = null;
    loadInsightsDetail({ refreshAccount: true, liveRefresh: true });
  });

  // AI 顧問按鈕
  $('#btnRunAiInsights')?.addEventListener('click', triggerAiAnalysis);
  $('#btnTriggerAiAnalysis')?.addEventListener('click', triggerAiAnalysis);

  // 排行榜排序切換
  $('#leaderboardSort')?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="leaderboardSort"]');
    if (!input) return;
    currentLeaderboardSort = input.value;
    renderInsights();
  });
}
