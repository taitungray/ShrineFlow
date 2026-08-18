import { $, escapeHtml, formatDate, showToast } from './dom.js';
import { api } from './api.js';
import { clientQuery, state, PLATFORM_NAMES } from './state.js';
import { platformMarkHtml, platformPillHtml } from './platform-icon.js';
import { refreshNavBadges } from './overview.js';

const INBOX_VISIBLE_LIMIT = 50;

function sourceStatus(source, connected) {
  if (source?.status === 'synced') {
    return '已同步 ' + (source.fetchedAt ? formatDate(source.fetchedAt) : '最新資料')
      + (source.syncPending ? ' · 已依平台更新重新同步' : '')
      + (source.filter?.unreadOnly ? ' · 未讀篩選' : '')
      + (source.filter?.needsReplyOnly ? ' · 待回篩選' : '');
  }
  if (source?.status === 'error') return '同步失敗：' + (source.error?.message || '請檢查權限');
  if (source?.status === 'not_configured' || !connected) return '尚未連線或未授權';
  return '尚未同步';
}

function counterpartName(item) {
  return String(item?.author || '').trim() || '對方（名稱未提供）';
}

function initials(name) {
  const text = String(name || '').trim();
  return text ? text.slice(0, 1) : '?';
}

function threadMessages(item) {
  if (Array.isArray(item?.messages) && item.messages.length) return item.messages;
  if (!item) return [];
  const text = String(item.text || '').trim();
  if (!text) return [];
  return [{
    id: item.id,
    text,
    createdAt: item.createdAt,
    author: counterpartName(item),
    fromPage: false,
  }];
}

function savedReplyOptions() {
  return state.savedReplies.map((reply) => '<option value="' + escapeHtml(reply.id) + '">'
    + escapeHtml(reply.title || reply.shortcut || reply.id) + '</option>').join('');
}

function renderItems(source) {
  const items = Array.isArray(source?.items) ? source.items.slice(0, INBOX_VISIBLE_LIMIT) : [];
  if (!items.length) return '<p class="inbox-empty-source">目前沒有讀到最近對話或回覆。</p>';
  return '<ul class="inbox-thread-list">' + items.map((item, index) => {
    const name = counterpartName(item);
    const messages = threadMessages(item);
    const bubbles = messages.map((message) => (
      '<li class="inbox-bubble" data-from="' + (message.fromPage ? 'page' : 'them') + '">'
      + '<strong>' + escapeHtml(message.fromPage ? '粉專回覆' : (message.author || name)) + '</strong>'
      + '<p>' + escapeHtml(message.text || '（沒有文字內容）') + '</p>'
      + '<small>' + escapeHtml(message.createdAt ? formatDate(message.createdAt) : '時間未提供') + '</small>'
      + '</li>'
    )).join('');
    return '<li class="inbox-item inbox-thread" data-inbox-item-id="' + escapeHtml(item.id)
      + '" data-inbox-recipient-id="' + escapeHtml(item.recipientId || '')
      + '" data-inbox-reply-to-id="' + escapeHtml(item.replyToId || item.id) + '">'
      + '<div class="inbox-thread-heading">'
      + '<span class="inbox-avatar" aria-hidden="true">' + escapeHtml(initials(name)) + '</span>'
      + '<div><h3>' + escapeHtml(name) + '</h3><span>'
      + (item.unread ? '未讀 · ' : '')
      + escapeHtml(item.type === 'reply' ? '回覆' : '對話')
      + ' · ' + messages.length + ' 則'
      + (item.replyCount > messages.length ? '／共 ' + Number(item.replyCount) + ' 則' : '')
      + '</span></div></div>'
      + '<ol class="inbox-thread-messages">' + bubbles + '</ol>'
      + '<div class="inbox-item-fields">'
      + '<div class="field"><label for="inbox-tags-' + index + '" class="field-label">標籤</label><input id="inbox-tags-' + index + '" data-inbox-tags type="text" value="' + escapeHtml((item.tags || []).join(', ')) + '" placeholder="客戶, 待回覆" /></div>'
      + '<div class="field"><label for="inbox-note-' + index + '" class="field-label">備註</label><textarea id="inbox-note-' + index + '" data-inbox-note rows="2" placeholder="只保存本機備註，不保存訊息全文。">' + escapeHtml(item.note || '') + '</textarea></div>'
      + '</div><div class="inbox-item-actions">'
      + '<button type="button" class="btn-text" data-inbox-toggle="' + (!item.unread) + '">' + (item.unread ? '標記已讀' : '標記未讀') + '</button>'
      + '<button type="button" class="btn-text" data-inbox-pending="' + (!item.needsReply) + '">' + (item.needsReply ? '取消待回' : '標記待回') + '</button>'
      + '<button type="button" class="btn-text" data-inbox-save>儲存標籤／備註</button>'
      + '</div><div class="field inbox-reply-field"><label for="inbox-reply-' + index + '" class="field-label">回覆 ' + escapeHtml(name) + '</label><select data-inbox-saved-reply aria-label="套用 Saved reply"><option value="">套用 Saved reply…</option>' + savedReplyOptions() + '</select><textarea id="inbox-reply-' + index + '" data-inbox-reply rows="2" maxlength="2000" placeholder="送出前請確認平台權限與回覆對象。"></textarea><button type="button" class="btn-secondary" data-inbox-reply-send>送出回覆</button></div></li>';
  }).join('') + '</ul>';
}

async function refreshInbox(useCursor = false) {
  const params = new URLSearchParams();
  if (useCursor) params.set('useCursor', 'true');
  params.set('limit', String(INBOX_VISIBLE_LIMIT));
  if (state.inboxFilter === 'unread') params.set('unreadOnly', 'true');
  if (state.inboxFilter === 'needsReply') params.set('needsReplyOnly', 'true');
  const query = params.toString();
  const path = clientQuery('/api/inbox' + (query ? '?' + query : ''));
  state.inbox = await api(path);
  renderInbox();
}

async function refreshSavedReplies() {
  state.savedReplies = await api(clientQuery('/api/saved-replies'));
  renderSavedReplies();
  renderInbox();
}

function renderSavedReplies() {
  const list = $('#savedReplyList');
  if (!list) return;
  if (!state.savedReplies.length) {
    list.innerHTML = '<p class="helper">尚未建立 Saved reply。</p>';
    return;
  }
  list.innerHTML = state.savedReplies.map((reply) => '<div class="saved-reply-row" data-saved-reply-id="'
    + escapeHtml(reply.id) + '"><span><strong>' + escapeHtml(reply.title) + '</strong><small>'
    + escapeHtml(reply.shortcut ? '／' + reply.shortcut + ' · ' : '') + escapeHtml(reply.text) + '</small></span><span class="saved-reply-actions"><button class="btn-text" type="button" data-saved-reply-edit>編輯</button><button class="btn-text schedule-action-danger" type="button" data-saved-reply-delete>刪除</button></span></div>').join('');
}

function renderInboxFilters() {
  document.querySelectorAll('#inboxFilters input[name="inboxFilter"]').forEach((input) => {
    input.checked = input.value === state.inboxFilter;
  });
  const scope = $('#inboxFilterScope');
  if (!scope) return;
  const label = state.inboxFilter === 'unread' ? '未讀' : state.inboxFilter === 'needsReply' ? '待回' : '全部';
  const total = state.inbox?.sources?.reduce((sum, source) => sum + (Number(source.providerItemCount) || 0), 0) || 0;
  const hasMore = state.inbox?.sources?.some((source) => source.cursor?.available);
  scope.textContent = `${label}篩選只作用於這次讀到的 ${total || 0} 則對話（一次最多 ${INBOX_VISIBLE_LIMIT} 則）`
    + (hasMore ? '。平台還有下一頁，按「再讀下一頁」。' : '。平台這頁沒有更多。');
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
      const pending = event.target.closest('[data-inbox-pending]');
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
      } else if (pending) {
        pending.disabled = true;
        await api('/api/inbox/items/' + encodeURIComponent(item.dataset.inboxItemId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...bodyBase, needsReply: pending.dataset.inboxPending === 'true' }),
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
  grid.addEventListener('change', (event) => {
    const select = event.target.closest('[data-inbox-saved-reply]');
    if (!select) return;
    const reply = state.savedReplies.find((item) => item.id === select.value);
    const item = select.closest('.inbox-item');
    const textarea = item?.querySelector('[data-inbox-reply]');
    if (reply && textarea) textarea.value = reply.text;
    if (select) select.value = '';
  });
  document.querySelectorAll('#inboxFilters input[name="inboxFilter"]').forEach((input) => input.addEventListener('change', async () => {
    state.inboxFilter = input.value;
    try {
      await refreshInbox();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }));
  $('#refreshInboxButton')?.addEventListener('click', async () => {
    try {
      await refreshInbox();
      showToast('收件匣已重新同步。', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
  $('#savedReplyForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('#savedReplyId')?.value || '';
    const body = {
      clientId: state.currentClientId,
      title: $('#savedReplyTitle')?.value || '',
      shortcut: $('#savedReplyShortcut')?.value || '',
      text: $('#savedReplyText')?.value || '',
    };
    const status = $('#savedReplyStatus');
    try {
      await api('/api/saved-replies' + (id ? '/' + encodeURIComponent(id) : ''), {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      $('#savedReplyForm').reset();
      $('#savedReplyId').value = '';
      $('#savedReplyCancelButton')?.classList.add('is-hidden');
      if (status) status.textContent = '已儲存。';
      await refreshSavedReplies();
      showToast('Saved reply 已儲存。', 'success');
    } catch (error) {
      if (status) status.textContent = error.message;
      showToast(error.message, 'error');
    }
  });
  $('#savedReplyCancelButton')?.addEventListener('click', () => {
    $('#savedReplyForm')?.reset();
    $('#savedReplyId').value = '';
    $('#savedReplyCancelButton')?.classList.add('is-hidden');
  });
  $('#savedReplyList')?.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-saved-reply-id]');
    if (!row) return;
    const reply = state.savedReplies.find((item) => item.id === row.dataset.savedReplyId);
    if (!reply) return;
    if (event.target.closest('[data-saved-reply-edit]')) {
      $('#savedReplyId').value = reply.id;
      $('#savedReplyTitle').value = reply.title || '';
      $('#savedReplyShortcut').value = reply.shortcut || '';
      $('#savedReplyText').value = reply.text || '';
      $('#savedReplyCancelButton')?.classList.remove('is-hidden');
      $('#savedReplyTitle')?.focus();
      return;
    }
    if (event.target.closest('[data-saved-reply-delete]')) {
      if (!window.confirm(`確定刪除「${reply.title}」？`)) return;
      try {
        await api('/api/saved-replies/' + encodeURIComponent(reply.id), { method: 'DELETE' });
        await refreshSavedReplies();
        showToast('Saved reply 已刪除。', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      }
    }
  });
  $('#inboxPlatformTabs')?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="inboxPlatform"]');
    if (!input) return;
    state.inboxPlatform = input.value;
    renderInbox();
  });
  renderSavedReplies();
  renderInboxFilters();
}

function renderInboxPlatformTabs(platforms, sources) {
  const tabs = $('#inboxPlatformTabs');
  if (!tabs) return;
  const available = platforms.map((platform) => platform.id);
  if (!available.includes(state.inboxPlatform)) state.inboxPlatform = available[0] || 'facebook';
  tabs.innerHTML = platforms.map((platform) => {
    const matches = sources.filter((item) => item.platformId === platform.id);
    const count = matches.reduce((sum, source) => sum + (Array.isArray(source.items) ? source.items.length : 0), 0);
    return platformPillHtml(platform.id, {
      name: 'inboxPlatform',
      checked: platform.id === state.inboxPlatform,
      count: count || '',
    });
  }).join('');
}

export function renderInbox() {
  const grid = $('#inboxPlatformGrid');
  if (!grid) return;
  const platforms = state.platforms.length
    ? state.platforms
    : Object.keys(PLATFORM_NAMES).map((id) => ({ id, name: PLATFORM_NAMES[id], enabled: false }));
  const client = state.clients.find((item) => item.id === state.currentClientId) || state.clients[0];
  const sources = state.inbox?.sources || [];
  renderInboxPlatformTabs(platforms, sources);
  const matches = sources.filter((item) => item.platformId === state.inboxPlatform);
  const cards = (matches.length ? matches : [null]).map((source) => {
    const connected = (client?.accounts || []).some((account) => account.platformId === state.inboxPlatform && account.configured);
    const itemCount = Array.isArray(source?.items) ? Math.min(source.items.length, INBOX_VISIBLE_LIMIT) : 0;
    const totalCount = Array.isArray(source?.items) ? source.items.length : 0;
    const filteredLabel = source?.filteredOutCount ? ' 已依目前篩選隱藏 ' + source.filteredOutCount + ' 筆。' : '';
    const countLabel = source?.status === 'synced'
      ? '顯示 ' + itemCount + (totalCount > itemCount ? '／' + totalCount : '') + ' 則對話，每則最多 20 則來回。資料由平台即時提供。' + filteredLabel
      : (source?.error?.message ? escapeHtml(source.error.message) : '只顯示平台目前允許讀取的資料，不建立永久訊息倉儲。');
    return '<article class="inbox-platform-card" data-status="' + escapeHtml(source?.status || 'unavailable')
      + '" data-account-id="' + escapeHtml(source?.accountId || '')
      + '" data-platform-id="' + escapeHtml(state.inboxPlatform) + '">'
      + '<div class="inbox-platform-heading">' + platformMarkHtml(state.inboxPlatform)
      + '<div><h3>' + (source?.accountName ? escapeHtml(source.accountName) : '收件匣') + '</h3><span>'
      + escapeHtml(sourceStatus(source, connected)) + '</span></div></div><p>'
      + countLabel + '</p>' + renderItems(source)
      + (source?.cursor?.available ? '<button type="button" class="btn-secondary" data-inbox-next-cursor>再讀下一頁（最多再 ' + INBOX_VISIBLE_LIMIT + ' 則）</button>' : '')
      + (source?.status !== 'synced' ? '<a class="btn-text" href="#/platforms">查看平台設定 →</a>' : '')
      + '</article>';
  });
  grid.innerHTML = cards.join('');
  renderSavedReplies();
  renderInboxFilters();
  refreshNavBadges();
}
