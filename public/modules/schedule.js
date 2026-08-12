import { $, escapeHtml, formatDate, setPreviewMessage, showToast, fieldValue, setFieldValue } from './dom.js';
import { state, PLATFORM_NAMES } from './state.js';
import { renderAccountOptions, renderContentTypeOptions, renderContentSettings, readContentSettings } from './platform-ui.js';
import { api } from './api.js';

export function renderSchedule() {
  const container = $('#scheduleList');
  if (!container) return;
  if (!state.schedule.length) {
    container.className = 'list-empty';
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📅</span><p>還沒有排程，產生並儲存草稿後即可排程發布。</p></div>';
    return;
  }
  container.className = 'record-list';
  const statusLabels = {
    pending: '待發布',
    publishing: '發布中',
    retrying: '等待重試',
    published: '已發布',
    failed: '發布失敗',
  };
  container.innerHTML = state.schedule.slice(0, 8).map((item) => {
    const post = state.posts.find((record) => record.id === item.postId);
    const name = escapeHtml(post ? post.godName : '未命名貼文');
    const status = statusLabels[item.status] || item.status;
    const error = item.lastError?.message ? ' title="' + escapeHtml(item.lastError.message) + '"' : '';
    const attempts = item.attempts > 1 ? ' · 第 ' + item.attempts + ' 次' : '';
    const channel = PLATFORM_NAMES[item.channel] || item.channel || '未指定平台';
    const account = state.accounts.find((entry) => entry.id === item.accountId);
    const accountName = account?.name || item.accountId || '未指定帳號';
    const platform = state.platforms.find((entry) => entry.id === item.channel);
    const contentType = platform?.contentTypes?.find((entry) => entry.id === item.contentType);
    const format = contentType?.name || item.contentType || '貼文';
    return '<div class="schedule-card"' + error + '><span class="calendar-icon">' + new Date(item.scheduledAt).getDate() + '</span><span><strong>' + name + '</strong><small>' + escapeHtml(channel) + ' ・ ' + escapeHtml(accountName) + ' ・ ' + escapeHtml(format) + ' ・ ' + formatDate(item.scheduledAt) + attempts + '</small></span><em data-status="' + escapeHtml(item.status) + '">' + escapeHtml(status) + '</em></div>';
  }).join('');
}

export function initScheduleDialog(refreshListsFn) {
  const scheduleBtn = $('#scheduleButton');
  if (scheduleBtn) {
    scheduleBtn.addEventListener('click', () => {
      if (!state.savedPost) return setPreviewMessage('請先儲存草稿，再安排時間。', 'error');
      const dialog = $('#scheduleDialog');
      const now = new Date(Date.now() + 60 * 60 * 1000);
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      $('#scheduledAt').value = now.toISOString().slice(0, 16);
      setFieldValue($('#scheduleChannel'), 'facebook');
      renderAccountOptions('facebook');
      renderContentTypeOptions('facebook');
      dialog.showModal();
    });
  }

  const channelSel = $('#scheduleChannel');
  if (channelSel) {
    channelSel.addEventListener('change', (event) => {
      renderAccountOptions(event.target.value);
      renderContentTypeOptions(event.target.value);
    });
  }

  const contentTypeSel = $('#scheduleContentType');
  if (contentTypeSel) {
    contentTypeSel.addEventListener('change', (event) => renderContentSettings(fieldValue($('#scheduleChannel')), event.target.value));
  }

  const form = $('#scheduleForm');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postId: state.savedPost.id,
            scheduledAt: new Date($('#scheduledAt').value).toISOString(),
            channel: fieldValue($('#scheduleChannel')) || 'facebook',
            accountId: $('#scheduleAccount').value,
            contentType: fieldValue($('#scheduleContentType')) || 'post',
            contentSettings: readContentSettings(),
          }),
        });
        $('#scheduleDialog').close();
        if (typeof refreshListsFn === 'function') await refreshListsFn();
        const message = state.config?.facebookConnected
          ? '排程已儲存，到期後會自動發布到 Facebook。'
          : '排程已儲存；設定 Facebook 憑證後才會自動發布。';
        setPreviewMessage(message, state.config?.facebookConnected ? 'success' : '');
        showToast(message, state.config?.facebookConnected ? 'success' : 'info');
      } catch (error) {
        setPreviewMessage(error.message, 'error');
      }
    });
  }
}
