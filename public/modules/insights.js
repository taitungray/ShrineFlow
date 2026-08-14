import { $, escapeHtml, formatDate } from './dom.js';
import { api } from './api.js';
import { clientQuery, state, PLATFORM_NAMES } from './state.js';

function targetsOf(post) {
  return Array.isArray(post.targets) && post.targets.length
    ? post.targets
    : [{ platformId: post.channel || 'facebook', status: post.status || 'draft' }];
}

function platformLabel(platformId) {
  return PLATFORM_NAMES[platformId] || platformId || '未指定平台';
}

function metricSummary(source) {
  const metrics = (source?.data || []).map((metric) => {
    const values = Array.isArray(metric.values) ? metric.values : [];
    const latest = values.length ? values[values.length - 1]?.value : metric.value;
    if (latest === undefined || latest === null) return '';
    return escapeHtml(String(metric.name || metric.title || 'metric')) + ' <strong>' + escapeHtml(String(latest)) + '</strong>';
  }).filter(Boolean).slice(0, 4);
  return metrics.length ? metrics.join(' · ') : 'API 已回應，但目前沒有可顯示的指標。';
}

function sourceStatusText(source) {
  if (!source) return '尚未同步真實成效';
  if (source.status === 'synced') {
    return '已同步 ' + (source.fetchedAt ? escapeHtml(formatDate(source.fetchedAt)) : '最新資料');
  }
  if (source.status === 'cached') {
    return '顯示已保存資料 ' + (source.fetchedAt ? escapeHtml(formatDate(source.fetchedAt)) : '') + '（非即時）';
  }
  if (source.status === 'error') {
    return '同步失敗：' + escapeHtml(source.error?.message || '請檢查平台權限與 Token');
  }
  if (source.status === 'not_available') {
    return escapeHtml(source.error?.message || '此 target 尚無可用的貼文 Insights。');
  }
  if (source.status === 'not_configured') {
    return escapeHtml(source.error?.message || '尚未設定此平台 Insights 憑證');
  }
  return '尚未設定此平台 Insights 憑證';
}

async function loadInsightsScope(scope) {
  state.insightsScope = scope;
  state.insights = await api(clientQuery('/api/insights?scope=' + encodeURIComponent(scope)));
  renderInsights();
}

export function initInsightsListeners() {
  const filter = $('#insightsScopeFilter');
  filter?.addEventListener('change', async (event) => {
    const scope = event.target.value === 'posts' ? 'posts' : 'account';
    try {
      await loadInsightsScope(scope);
    } catch (error) {
      const notice = $('#insightsSourceNotice');
      if (notice) notice.innerHTML = '<strong>成效讀取失敗</strong><span>' + escapeHtml(error.message) + '</span>';
    }
  });

  $('#btnRefreshInsights')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await loadInsightsScope(state.insightsScope || 'account');
    } catch (error) {
      const notice = $('#insightsSourceNotice');
      if (notice) notice.innerHTML = '<strong>成效讀取失敗</strong><span>' + escapeHtml(error.message) + '</span>';
    } finally {
      button.disabled = false;
    }
  });
}

export function renderInsights() {
  const summary = $('#insightsOperationalSummary');
  const platformGrid = $('#insightsPlatformGrid');
  const targetGrid = $('#insightsTargetGrid');
  const notice = $('#insightsSourceNotice');
  if (!summary || !platformGrid) return;
  const posts = state.posts || [];
  const targets = posts.flatMap(targetsOf);
  const published = targets.filter((target) => target.status === 'published').length;
  const scheduled = targets.filter((target) => ['scheduled', 'pending', 'publishing'].includes(target.status)).length;
  const failed = targets.filter((target) => ['failed', 'retrying'].includes(target.status)).length;
  const partial = posts.filter((post) => post.status === 'partial_success').length;
  summary.innerHTML = [['內容總數', posts.length, '目前品牌'], ['已發布目標', published, '本機發布狀態'], ['部分成功', partial, '需確認的平台'], ['排程中', scheduled, '待處理目標'], ['需處理', failed, '失敗或重試']].map(([label, value, noteText]) => '<div class="module-summary-card"><span>' + label + '</span><strong>' + value + '</strong><small>' + noteText + '</small></div>').join('');
  const insights = state.insights || { status: 'unavailable', sources: [] };
  const scope = insights.scope || state.insightsScope || 'account';
  state.insightsScope = scope;
  const scopeInput = document.querySelector('#insightsScopeFilter input[value="' + scope + '"]');
  if (scopeInput) scopeInput.checked = true;
  if (notice) {
    const latest = posts.map((post) => post.updatedAt || post.createdAt).filter(Boolean).sort().pop();
    const externalText = insights.status === 'synced' || insights.status === 'partial'
      ? '下方平台成效只顯示已由 Meta API 回傳的真實資料。'
      : '目前沒有可用的真實平台成效；未同步時不顯示推測數字。';
    notice.innerHTML = '<strong>目前顯示營運資料</strong><span>本機內容與 target 狀態可直接查看；' + externalText + '</span>' + (latest ? '<small>本機內容最後更新：' + escapeHtml(formatDate(latest)) + '</small>' : '');
  }
  const platformIds = state.platforms.length ? state.platforms.map((platform) => platform.id) : Object.keys(PLATFORM_NAMES);
  platformGrid.innerHTML = platformIds.map((platformId) => {
    const platformTargets = targets.filter((target) => target.platformId === platformId);
    const platformPublished = platformTargets.filter((target) => target.status === 'published').length;
    const platformFailed = platformTargets.filter((target) => ['failed', 'retrying'].includes(target.status)).length;
    const source = (insights.sources || []).find((item) => item.platformId === platformId);
    const externalStats = ['synced', 'cached'].includes(source?.status)
      ? metricSummary(source) + ' · ' + sourceStatusText(source)
      : sourceStatusText(source);
    return '<article class="insights-platform-card"><div class="insights-platform-heading"><span class="platform-mark" data-platform="' + escapeHtml(platformId) + '">' + escapeHtml((platformLabel(platformId)[0] || '?').toUpperCase()) + '</span><div><h3>' + escapeHtml(platformLabel(platformId)) + '</h3><span>本機發布摘要</span></div></div><div class="insights-platform-stats"><span>目標 <strong>' + platformTargets.length + '</strong></span><span>成功 <strong>' + platformPublished + '</strong></span><span>需處理 <strong>' + platformFailed + '</strong></span></div><p class="insights-external-stats" data-status="' + escapeHtml(source?.status || 'unavailable') + '">' + externalStats + '</p></article>';
  }).join('');

  if (targetGrid) {
    targetGrid.classList.toggle('is-hidden', scope !== 'posts');
    if (scope === 'posts') {
      const sources = insights.sources || [];
      targetGrid.innerHTML = sources.length
        ? sources.map((source) => '<article class="insights-target-card"><div class="insights-target-heading"><span class="platform-mark" data-platform="' + escapeHtml(source.platformId) + '">' + escapeHtml((platformLabel(source.platformId)[0] || '?').toUpperCase()) + '</span><div><h3>' + escapeHtml(source.postTitle || source.postId || source.targetId || '未命名內容') + '</h3><small>' + escapeHtml(source.accountName || source.accountId || '') + '</small></div></div><p class="insights-external-stats" data-status="' + escapeHtml(source.status || 'unavailable') + '">' + (['synced', 'cached'].includes(source.status) ? metricSummary(source) + ' · ' : '') + sourceStatusText(source) + '</p></article>').join('')
        : '<p class="helper">目前品牌沒有已發布且帶有平台貼文 ID 的 target。</p>';
    } else {
      targetGrid.innerHTML = '';
    }
  }
}
