import { $, escapeHtml, formatDate, setPreviewMessage, showToast, fieldValue, setFieldValue } from './dom.js';
import { state, PLATFORM_NAMES } from './state.js';
import { renderAccountOptions, renderContentTypeOptions, renderContentSettings, readContentSettings } from './platform-ui.js';
import { api } from './api.js';

let reschedulingItem = null;

function toLocalDateTimeValue(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function scheduleActions(item) {
  if (!['facebook', 'instagram', 'threads'].includes(item.channel)) return '';
  const buttons = [];
  if (item.status === 'scheduled') {
    buttons.push(
      '<button class="btn-text schedule-action" type="button" data-schedule-action="reschedule" data-target-id="'
      + escapeHtml(item.targetId) + '">改時間</button>',
      '<button class="btn-text schedule-action schedule-action-danger" type="button" data-schedule-action="cancel" data-target-id="'
      + escapeHtml(item.targetId) + '">取消</button>',
    );
  }
  if (item.status === 'failed' || item.status === 'retrying') {
    buttons.push(
      '<button class="btn-text schedule-action" type="button" data-schedule-action="retry" data-target-id="'
      + escapeHtml(item.targetId) + '" data-post-id="'
      + escapeHtml(item.postId) + '">重發</button>',
    );
  }
  if (!buttons.length) return '';
  return '<div class="schedule-actions">' + buttons.join('') + '</div>';
}

function scheduleQueueLabel(channel) {
  if (channel === 'facebook') return 'Facebook 平台佇列';
  return `${PLATFORM_NAMES[channel] || channel} 本機排程`;
}

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
    scheduled: '已排程',
    publishing: '發布中',
    retrying: '等待重試',
    published: '已發布',
    failed: '發布失敗',
    skipped_unsupported: '尚未支援',
    draft: '草稿',
  };
  container.innerHTML = state.schedule.slice(0, 8).map((item) => {
    const post = state.posts.find((record) => record.id === item.postId);
    const name = escapeHtml(post ? post.godName : '未命名貼文');
    const status = statusLabels[item.status] || item.status;
    const error = item.lastError?.message ? ' title="' + escapeHtml(item.lastError.message) + '"' : '';
    const attempts = item.attempts > 1 ? ' · 第 ' + item.attempts + ' 次' : '';
    const channel = PLATFORM_NAMES[item.channel] || item.channel || '未指定平台';
    const account = state.accounts.find((entry) => entry.id === item.accountId);
    const accountName = account?.name || PLATFORM_NAMES[item.channel] || item.channel || '未指定平台';
    const platform = state.platforms.find((entry) => entry.id === item.channel);
    const contentType = platform?.contentTypes?.find((entry) => entry.id === item.contentType);
    const format = contentType?.name || item.contentType || '貼文';
    return '<div class="schedule-card"' + error + '><span class="calendar-icon">' + new Date(item.scheduledAt).getDate() + '</span><span><strong>' + name + '</strong><small>' + escapeHtml(channel) + ' ・ ' + escapeHtml(accountName) + ' ・ ' + escapeHtml(format) + ' ・ ' + formatDate(item.scheduledAt) + attempts + '</small></span><em data-status="' + escapeHtml(item.status) + '">' + escapeHtml(status) + '</em>' + scheduleActions(item) + '</div>';
  }).join('');
}

export function initScheduleDialog(refreshListsFn) {
  const dialog = $('#scheduleDialog');
  if (dialog) {
    dialog.addEventListener('close', () => {
      reschedulingItem = null;
    });
  }
  const list = $('#scheduleList');
  if (list) {
    list.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-schedule-action]');
      if (!button) return;
      const item = state.schedule.find((entry) => entry.targetId === button.dataset.targetId);
      if (!item) return;
      if (button.dataset.scheduleAction === 'cancel') {
        const queueLabel = scheduleQueueLabel(item.channel);
        if (!window.confirm(`確定取消「${queueLabel}」？`)) return;
        try {
          await api('/api/schedule/' + encodeURIComponent(item.targetId), { method: 'DELETE' });
          if (typeof refreshListsFn === 'function') await refreshListsFn();
          showToast(`已取消 ${queueLabel}。`, 'success');
        } catch (error) {
          showToast(error.message, 'error');
        }
        return;
      }
      if (button.dataset.scheduleAction === 'retry') {
        const platformName = PLATFORM_NAMES[item.channel] || item.channel;
        if (!window.confirm(`確定立刻重發「${platformName}」？`)) return;
        try {
          showToast('重發中…', 'info');
          await api('/api/publish/target', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId: item.postId || button.dataset.postId,
              targetId: item.targetId,
            }),
          });
          if (typeof refreshListsFn === 'function') await refreshListsFn();
          showToast(`${platformName} 已重發成功。`, 'success');
        } catch (error) {
          if (typeof refreshListsFn === 'function') await refreshListsFn();
          showToast(error.message || '重發失敗。', 'error');
        }
        return;
      }
      reschedulingItem = item;
      const dialog = $('#scheduleDialog');
      const timeInput = $('#scheduledAt');
      if (!dialog || !timeInput) return;
      timeInput.value = toLocalDateTimeValue(item.scheduledAt);
      setFieldValue($('#scheduleChannel'), item.channel);
      renderAccountOptions(item.channel);
      renderContentTypeOptions(item.channel);
      setFieldValue($('#scheduleContentType'), item.contentType);
      renderContentSettings(item.channel, item.contentType);
      dialog.showModal();
    });
  }

  const scheduleBtn = $('#scheduleButton');
  if (scheduleBtn) {
    scheduleBtn.addEventListener('click', () => {
      reschedulingItem = null;
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
        const scheduledAt = new Date($('#scheduledAt').value).toISOString();
        const isRescheduling = Boolean(reschedulingItem);
        const channel = fieldValue($('#scheduleChannel')) || 'facebook';
        if (isRescheduling) {
          await api('/api/schedule/' + encodeURIComponent(reschedulingItem.targetId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduledAt }),
          });
        } else {
          await api('/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId: state.savedPost.id,
              targetId: state.activeTargetId || undefined,
              scheduledAt,
              channel,
              accountId: $('#scheduleAccount').value || state.activeTargetId,
              contentType: fieldValue($('#scheduleContentType')) || 'post',
              contentSettings: readContentSettings(),
            }),
          });
        }
        $('#scheduleDialog').close();
        reschedulingItem = null;
        if (typeof refreshListsFn === 'function') await refreshListsFn();
        const message = isRescheduling
          ? `${scheduleQueueLabel(channel)}時間已更新。`
          : channel === 'facebook'
            ? '已交 Facebook 排程佇列'
            : '已加入本機排程（到期時需服務運行中）';
        setPreviewMessage(message, 'success');
        showToast(message, 'success');
      } catch (error) {
        setPreviewMessage(error.message, 'error');
      }
    });
  }
}
