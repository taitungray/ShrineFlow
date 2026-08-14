import { $, escapeHtml } from './dom.js';
import { state, PLATFORM_NAMES } from './state.js';

export function renderInbox() {
  const grid = $('#inboxPlatformGrid');
  if (!grid) return;
  const platforms = state.platforms.length
    ? state.platforms
    : Object.keys(PLATFORM_NAMES).map((id) => ({ id, name: PLATFORM_NAMES[id], enabled: false }));
  const client = state.clients.find((item) => item.id === state.currentClientId) || state.clients[0];
  grid.innerHTML = platforms.map((platform) => {
    const connected = (client?.accounts || []).some((account) => account.platformId === platform.id && account.configured);
    const name = platform.shortName || platform.name || PLATFORM_NAMES[platform.id] || platform.id;
    return '<article class="inbox-platform-card"><div class="inbox-platform-heading"><span class="platform-mark" data-platform="' + escapeHtml(platform.id) + '">' + escapeHtml((name[0] || '?').toUpperCase()) + '</span><div><h3>' + escapeHtml(name) + '</h3><span>' + (connected ? '平台已連線' : '尚未連線') + '</span></div></div><p>' + (connected ? '已具備平台連線，可在後續開啟訊息同步權限。' : '請先完成平台連線，再評估留言與訊息接入。') + '</p><a class="btn-text" href="#/platforms">查看平台設定 →</a></article>';
  }).join('');
}
