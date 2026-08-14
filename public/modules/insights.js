import { $, escapeHtml, formatDate } from './dom.js';
import { state, PLATFORM_NAMES } from './state.js';

function targetsOf(post) {
  return Array.isArray(post.targets) && post.targets.length
    ? post.targets
    : [{ platformId: post.channel || 'facebook', status: post.status || 'draft' }];
}

function platformLabel(platformId) {
  return PLATFORM_NAMES[platformId] || platformId || '未指定平台';
}

export function renderInsights() {
  const summary = $('#insightsOperationalSummary');
  const platformGrid = $('#insightsPlatformGrid');
  const notice = $('#insightsSourceNotice');
  if (!summary || !platformGrid) return;
  const posts = state.posts || [];
  const targets = posts.flatMap(targetsOf);
  const published = targets.filter((target) => target.status === 'published').length;
  const scheduled = targets.filter((target) => ['scheduled', 'pending', 'publishing'].includes(target.status)).length;
  const failed = targets.filter((target) => ['failed', 'retrying'].includes(target.status)).length;
  summary.innerHTML = [['內容總數', posts.length, '目前品牌'], ['已發布目標', published, '本機發布狀態'], ['排程中', scheduled, '待處理目標'], ['需處理', failed, '失敗或重試']].map(([label, value, noteText]) => '<div class="module-summary-card"><span>' + label + '</span><strong>' + value + '</strong><small>' + noteText + '</small></div>').join('');
  if (notice) {
    const latest = posts.map((post) => post.updatedAt || post.createdAt).filter(Boolean).sort().pop();
    notice.innerHTML = '<strong>目前顯示營運資料</strong><span>以上數字來自本機內容與 target 狀態；觸及、曝光、互動、點擊等平台成效尚未同步，因此不顯示推測數字。</span>' + (latest ? '<small>本機內容最後更新：' + escapeHtml(formatDate(latest)) + '</small>' : '');
  }
  const platformIds = state.platforms.length ? state.platforms.map((platform) => platform.id) : Object.keys(PLATFORM_NAMES);
  platformGrid.innerHTML = platformIds.map((platformId) => {
    const platformTargets = targets.filter((target) => target.platformId === platformId);
    const platformPublished = platformTargets.filter((target) => target.status === 'published').length;
    const platformFailed = platformTargets.filter((target) => ['failed', 'retrying'].includes(target.status)).length;
    return '<article class="insights-platform-card"><div class="insights-platform-heading"><span class="platform-mark" data-platform="' + escapeHtml(platformId) + '">' + escapeHtml((platformLabel(platformId)[0] || '?').toUpperCase()) + '</span><div><h3>' + escapeHtml(platformLabel(platformId)) + '</h3><span>本機發布摘要</span></div></div><div class="insights-platform-stats"><span>目標 <strong>' + platformTargets.length + '</strong></span><span>成功 <strong>' + platformPublished + '</strong></span><span>需處理 <strong>' + platformFailed + '</strong></span></div><p>平台觸及與互動資料尚未同步。</p></article>';
  }).join('');
}
