import { $, escapeHtml, formatDate } from './dom.js';
import { api } from './api.js';
import { clientQuery, state, PLATFORM_NAMES } from './state.js';

function sourceStatus(source, connected) {
  if (source?.status === 'synced') {
    return '已同步 ' + (source.fetchedAt ? formatDate(source.fetchedAt) : '最新資料')
      + (source.syncPending ? ' · 已依平台更新重新同步' : '');
  }
  if (source?.status === 'error') return '同步失敗：' + (source.error?.message || '請檢查權限');
  if (source?.status === 'not_configured' || !connected) return '尚未連線或未授權';
  return '尚未同步';
}

function renderItems(source) {
  const items = Array.isArray(source?.items) ? source.items : [];
  if (!items.length) return '<p class="inbox-empty-source">目前沒有讀到最近對話或回覆。</p>';
  return '<ul class="inbox-item-list">' + items.slice(0, 5).map((item, index) => (
    '<li class="inbox-item" data-inbox-item-id="' + escapeHtml(item.id) + '" data-inbox-recipient-id="' + escapeHtml(item.recipientId || '') + '" data-inbox-reply-to-id="' + escapeHtml(item.replyToId || item.id) + '"><div><strong>' + escapeHtml(item.author || '平台使用者') + '</strong><span>' + (item.unread ? '未讀 · ' : '') + escapeHtml(item.type === 'reply' ? '回覆' : '對話') + '</span></div>'
    + '<p>' + escapeHtml(item.text || '（沒有文字內容）') + '</p>'
    + '<small>' + escapeHtml(item.createdAt ? formatDate(item.createdAt) : '時間未提供') + '</small>'
    + '<div class="inbox-item-fields">'
    + '<div class="field"><label for="inbox-tags-' + index + '" class="field-label">標籤</label><input id="inbox-tags-' + index + '" data-inbox-tags type="text" value="' + escapeHtml((item.tags || []).join(', ')) + '" placeholder="客戶, 待回覆" /></div>'
    + '<div class="field"><label for="inbox-note-' + index + '" class="field-label">備註</label><textarea id="inbox-note-' + index + '" data-inbox-note rows="2" placeholder="只保存本機備註，不保存訊息全文。">' + escapeHtml(item.note || '') + '</textarea></div>'
    + '</div><div class="inbox-item-actions">'
    + '<button type="button" class="btn-text" data-inbox-toggle="' + (!item.unread) + '">' + (item.unread ? '標記已讀' : '標記未讀') + '</button>'
    + '<button type="button" class="btn-text" data-inbox-save>儲存標籤／備註</button>'
    + '</div><div class="field inbox-reply-field"><label for="inbox-reply-' + index + '" class="field-label">回覆平台使用者</label><textarea id="inbox-reply-' + index + '" data-inbox-reply rows="2" maxlength="2000" placeholder="送出前請確認平台權限與回覆對象。"></textarea><button type="button" class="btn-secondary" data-inbox-reply-send>送出回覆</button></div></li>'
  )).join('') + '</ul>';
}

async function refreshInbox(useCursor = false) {
  const path = clientQuery('/api/inbox' + (useCursor ? '?useCursor=true' : ''));
  state.inbox = await api(path);
  renderInbox();
}

export function initInboxListeners() {
  const grid = $('#inboxPlatformGrid');
  if (!grid) return;
  grid.addEventListener('click', async (event) => {
    const item = event.target.closest('.inbox-item');
    const nextCursor = event.target.closest('[data-inbox-next-cursor]');
    if (!item && !nextCursor) return;
    const sourceCard = event.target.closest('.inbox-platform-card');
    const source = state.inbox?.sources?.find((candidate) => candidate.accountId === sourceCard?.dataset.accountId
      && candidate.platformId === sourceCard?.dataset.platformId)
      || state.inbox?.sources?.find((candidate) => candidate.platformId === sourceCard?.dataset.platformId);
    if (!source) return;
    const bodyBase = {
      clientId: state.inbox?.clientId || state.currentClientId,
      accountId: source.accountId,
      platformId: source.platformId,
    };
    try {
      const toggle = event.target.closest('[data-inbox-toggle]');
      const save = event.target.closest('[data-inbox-save]');
      const reply = event.target.closest('[data-inbox-reply-send]');
      if (toggle) {
        toggle.disabled = true;
        await api('/api/inbox/items/' + encodeURIComponent(item.dataset.inboxItemId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...bodyBase, unread: toggle.dataset.inboxToggle === 'true' }),
        });
        await refreshInbox();
      } else if (save) {
        save.disabled = true;
        await api('/api/inbox/items/' + encodeURIComponent(item.dataset.inboxItemId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...bodyBase,
            tags: item.querySelector('[data-inbox-tags]')?.value || '',
            note: item.querySelector('[data-inbox-note]')?.value || '',
          }),
        });
        await refreshInbox();
      } else if (reply) {
        const replyText = item.querySelector('[data-inbox-reply]')?.value || '';
        reply.disabled = true;
        await api('/api/inbox/items/' + encodeURIComponent(item.dataset.inboxItemId) + '/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...bodyBase,
            recipientId: item.dataset.inboxRecipientId || '',
            replyToId: item.dataset.inboxReplyToId || item.dataset.inboxItemId,
            text: replyText,
          }),
        });
        await refreshInbox();
      } else if (nextCursor) {
        nextCursor.disabled = true;
        await refreshInbox(true);
      }
    } catch (error) {
      event.target.closest('article')?.setAttribute('data-error', error.message);
    }
  });
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
    return '<article class="inbox-platform-card" data-status="' + escapeHtml(source?.status || 'unavailable') + '" data-account-id="' + escapeHtml(source?.accountId || '') + '" data-platform-id="' + escapeHtml(platform.id) + '"><div class="inbox-platform-heading"><span class="platform-mark" data-platform="' + escapeHtml(platform.id) + '">' + escapeHtml((name[0] || '?').toUpperCase()) + '</span><div><h3>' + escapeHtml(name) + '</h3><span>' + escapeHtml(sourceStatus(source, connected)) + '</span></div></div><p>' + (source?.status === 'synced' ? '最近讀到 ' + itemCount + ' 筆，資料由平台即時提供。' : (source?.error?.message ? escapeHtml(source.error.message) : '只顯示平台目前允許讀取的資料，不建立永久訊息倉儲。')) + '</p>' + renderItems(source) + (source?.cursor?.available ? '<button type="button" class="btn-text" data-inbox-next-cursor>讀取下一頁 →</button>' : '') + (source?.status !== 'synced' ? '<a class="btn-text" href="#/platforms">查看平台設定 →</a>' : '') + '</article>';
  }).join('');
}
