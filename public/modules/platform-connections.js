import { $, escapeHtml } from './dom.js';
import { currentClient, PLATFORM_NAMES, state } from './state.js';

function platformName(platform) {
  return platform.shortName || platform.name || PLATFORM_NAMES[platform.id] || platform.id;
}

function tokenHealthLabel(account) {
  const health = account?.tokenHealth;
  if (!health || health.status === 'not_configured') return '';
  if (health.status === 'expired') return 'Token 已過期';
  if (health.status === 'expiring') return `Token ${health.expiresInDays} 天內到期`;
  if (health.status === 'valid') return `Token 尚餘 ${health.expiresInDays} 天`;
  if (health.connectionStatus === 'error') return '最近連線失敗';
  if (health.connectionStatus === 'connected') return '最近已驗證';
  return 'Token 到期資訊未提供';
}

export function renderPlatformConnections() {
  const grid = $('#platformConnectionGrid');
  const summary = $('#platformSummary');
  if (!grid) return;
  const platforms = state.platforms.length
    ? state.platforms
    : Object.keys(PLATFORM_NAMES).map((id) => ({ id, name: PLATFORM_NAMES[id], shortName: id, enabled: false, contentTypes: [] }));
  const client = currentClient();
  const cards = platforms.map((platform) => {
    const accounts = (client?.accounts || []).filter((account) => account.platformId === platform.id);
    const configured = accounts.some((account) => account.configured);
    const healthNotice = accounts.map(tokenHealthLabel).find(Boolean) || '';
    const status = configured ? 'connected' : platform.enabled ? 'ready' : 'not-ready';
    const statusLabel = configured ? '已連線' : platform.enabled ? '可設定' : '尚未連線';
    const types = (platform.contentTypes || []).map((type) => '<span class="platform-capability">' + escapeHtml(type.name) + '</span>').join('');
    return '<article class="platform-connection-card" data-status="' + status + '">'
      + '<div class="platform-connection-heading"><span class="platform-mark" data-platform="' + escapeHtml(platform.id) + '">' + escapeHtml((platformName(platform)[0] || '?').toUpperCase()) + '</span><div><h3>' + escapeHtml(platformName(platform)) + '</h3><span class="platform-connection-status" data-status="' + status + '">' + statusLabel + '</span></div></div>'
      + '<p>' + escapeHtml(platform.description || '此平台尚未提供連線說明。') + '</p>'
      + '<div class="platform-capabilities" aria-label="可用格式">' + (types || '<span class="helper">尚未取得格式</span>') + '</div>'
      + '<div class="platform-connection-footer"><span class="helper">' + (healthNotice || (accounts.length ? '目前品牌：' + accounts.length + ' 個平台連線' : '目前品牌尚未設定')) + '</span><a class="btn-text" href="#/settings">' + (configured ? '管理設定 →' : '前往設定 →') + '</a></div>'
      + '</article>';
  });
  if (summary) {
    const connected = platforms.filter((platform) => (client?.accounts || []).some((account) => account.platformId === platform.id && account.configured)).length;
    summary.innerHTML = [['已連線', connected], ['可管理平台', platforms.length], ['目前品牌', client?.name || '尚未選擇']].map(([label, value]) => '<div class="module-summary-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join('');
  }
  grid.innerHTML = cards.join('');
}
