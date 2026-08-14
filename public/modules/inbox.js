import { $, escapeHtml, formatDate } from './dom.js';
import { state, PLATFORM_NAMES } from './state.js';

function sourceStatus(source, connected) {
  if (source?.status === 'synced') {
    return '已同步 ' + (source.fetchedAt ? formatDate(source.fetchedAt) : '最新資料');
  }
  if (source?.status === 'error') return '同步失敗：' + (source.error?.message || '請檢查權限');
  if (source?.status === 'not_configured' || !connected) return '尚未連線或未授權';
  return '尚未同步';
}

function renderItems(source) {
  const items = Array.isArray(source?.items) ? source.items : [];
  if (!items.length) return '<p class="inbox-empty-source">目前沒有讀到最近對話或回覆。</p>';
  return '<ul class="inbox-item-list">' + items.slice(0, 5).map((item) => (
    '<li><div><strong>' + escapeHtml(item.author || '平台使用者') + '</strong><span>' + escapeHtml(item.type === 'reply' ? '回覆' : '對話') + '</span></div>'
    + '<p>' + escapeHtml(item.text || '（沒有文字內容）') + '</p>'
    + '<small>' + escapeHtml(item.createdAt ? formatDate(item.createdAt) : '時間未提供') + '</small></li>'
  )).join('') + '</ul>';
}

export function renderInbox() {
  const grid = $('#inboxPlatformGrid');
  if (!grid) return;
  const platforms = state.platforms.length
    ? state.platforms
    : Object.keys(PLATFORM_NAMES).map((id) => ({ id, name: PLATFORM_NAMES[id], enabled: false }));
  const client = state.clients.find((item) => item.id === state.currentClientId) || state.clients[0];
  const sources = state.inbox?.sources || [];
  grid.innerHTML = platforms.map((platform) => {
    const source = sources.find((item) => item.platformId === platform.id);
    const connected = (client?.accounts || []).some((account) => account.platformId === platform.id && account.configured);
    const name = platform.shortName || platform.name || PLATFORM_NAMES[platform.id] || platform.id;
    const itemCount = Array.isArray(source?.items) ? source.items.length : 0;
    return '<article class="inbox-platform-card" data-status="' + escapeHtml(source?.status || 'unavailable') + '"><div class="inbox-platform-heading"><span class="platform-mark" data-platform="' + escapeHtml(platform.id) + '">' + escapeHtml((name[0] || '?').toUpperCase()) + '</span><div><h3>' + escapeHtml(name) + '</h3><span>' + escapeHtml(sourceStatus(source, connected)) + '</span></div></div><p>' + (source?.status === 'synced' ? '最近讀到 ' + itemCount + ' 筆，資料由平台即時提供。' : (source?.error?.message ? escapeHtml(source.error.message) : '只顯示平台目前允許讀取的資料，不建立永久訊息倉儲。')) + '</p>' + renderItems(source) + (source?.status !== 'synced' ? '<a class="btn-text" href="#/platforms">查看平台設定 →</a>' : '') + '</article>';
  }).join('');
}
