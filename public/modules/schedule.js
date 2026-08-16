import { $, escapeHtml, formatDate, setPreviewMessage, showToast, fieldValue, setFieldValue } from './dom.js';
import { state, PLATFORM_NAMES, currentClient } from './state.js';
import { renderAccountOptions, renderContentTypeOptions, renderContentSettings, readContentSettings } from './platform-ui.js';
import { api } from './api.js';
import { getActiveTarget } from './targets-ui.js';
import { targetStatusLabel } from './status.js';

let reschedulingItem = null;
let draggedTargetId = '';
let calendarView = 'month';
let calendarCursor = new Date();
calendarCursor.setHours(0, 0, 0, 0);

const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function dateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function calendarLabel(start, end = start) {
  const formatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  if (dateKey(start) === dateKey(end)) return formatter.format(start);
  return formatter.formatRange ? formatter.formatRange(start, end) : `${formatter.format(start)} – ${formatter.format(end)}`;
}

function calendarItemMarkup(item) {
  const post = state.posts.find((record) => record.id === item.postId);
  const title = post?.title || post?.internalTitle || post?.contentTopic || post?.godName || '未命名內容';
  const channel = PLATFORM_NAMES[item.channel] || item.channel || '平台';
  const draggable = item.status === 'scheduled' ? ' draggable="true"' : '';
  return '<button class="calendar-item" type="button"' + draggable + ' data-calendar-target-id="' + escapeHtml(item.targetId) + '" data-status="' + escapeHtml(item.status || 'draft') + '">' +
    '<span class="calendar-item-platform">' + escapeHtml(channel) + '</span><span class="calendar-item-title">' + escapeHtml(title) + '</span></button>';
}

function renderCalendarGrid() {
  const grid = $('#calendarGrid');
  const panel = $('#schedulePanel');
  const label = $('#calendarMonthLabel');
  if (!grid || !panel) return;
  panel.dataset.calendarView = calendarView;
  grid.className = 'calendar-grid calendar-grid-' + calendarView;

  if (calendarView === 'list') {
    grid.innerHTML = '';
    if (label) label.textContent = '發布列表';
    return;
  }

  const days = [];
  let start;
  if (calendarView === 'week') {
    start = startOfWeek(calendarCursor);
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      days.push(date);
    }
  } else {
    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() || 7) - 1));
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      days.push(date);
    }
  }

  const end = days[days.length - 1];
  if (label) label.textContent = calendarView === 'week' ? calendarLabel(start, end) : new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long' }).format(calendarCursor);
  const today = dateKey(new Date());
  const currentMonth = calendarCursor.getMonth();
  const itemsByDate = new Map();
  state.schedule.forEach((item) => {
    const key = dateKey(new Date(item.scheduledAt));
    if (!key) return;
    const list = itemsByDate.get(key) || [];
    list.push(item);
    itemsByDate.set(key, list);
  });

  grid.innerHTML = '<div class="calendar-weekdays">' + CALENDAR_WEEKDAYS.map((day) => '<span>' + day + '</span>').join('') + '</div>'
    + '<div class="calendar-days">' + days.map((date) => {
      const key = dateKey(date);
      const items = itemsByDate.get(key) || [];
      const classes = [
        'calendar-day',
        key === today ? 'is-today' : '',
        calendarView === 'month' && date.getMonth() !== currentMonth ? 'is-outside' : '',
      ].filter(Boolean).join(' ');
      return '<div class="' + classes + '" data-calendar-date="' + escapeHtml(key) + '"><span class="calendar-day-number">' + date.getDate() + '</span>'
        + '<div class="calendar-day-items">' + items.slice(0, 4).map(calendarItemMarkup).join('')
        + (items.length > 4 ? '<span class="calendar-more">+' + (items.length - 4) + '</span>' : '') + '</div></div>';
    }).join('') + '</div>';
}

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
  const retryBlocked = ['REMOTE_PUBLISH_RECONCILIATION_REQUIRED', 'REMOTE_SCHEDULE_RECONCILIATION_REQUIRED']
    .includes(item.lastError?.code);
  if (!retryBlocked && (item.status === 'failed' || item.status === 'retrying')) {
    buttons.push(
      '<button class="btn-text schedule-action" type="button" data-schedule-action="retry" data-target-id="'
      + escapeHtml(item.targetId) + '" data-post-id="'
      + escapeHtml(item.postId) + '">重發</button>',
    );
  }
  const firstComment = item.channel === 'instagram' && item.firstComment?.text
    ? item.firstComment.status === 'failed'
      ? '<button class="btn-text schedule-action schedule-action-danger" type="button" data-schedule-action="first-comment-retry" data-target-id="'
        + escapeHtml(item.targetId) + '" data-post-id="' + escapeHtml(item.postId || '') + '">重試首則留言</button>'
      : item.firstComment.status === 'pending'
        ? '<span class="schedule-child-status">首則留言處理中</span>'
        : item.firstComment.status === 'published'
          ? '<span class="schedule-child-status is-success">首則留言已發布</span>'
          : ''
    : '';
  if (!buttons.length && !firstComment) return '';
  return '<div class="schedule-actions">' + buttons.join('') + firstComment + '</div>';
}

function scheduleQueueLabel(channel) {
  if (channel === 'facebook') return 'Facebook 平台佇列';
  return `${PLATFORM_NAMES[channel] || channel} 本機排程`;
}

function setScheduleMode(mode = 'manual', { locked = false } = {}) {
  setFieldValue($('#scheduleMode'), mode);
  const queueRadio = $('#scheduleModeQueue');
  if (queueRadio) queueRadio.disabled = locked;
  renderContentSettings(fieldValue($('#scheduleChannel')), fieldValue($('#scheduleContentType')));
}

export function renderSchedule() {
  const container = $('#scheduleList');
  if (!container) return;
  renderCalendarGrid();
  if (!state.schedule.length) {
    container.className = 'list-empty';
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📅</span><p>還沒有排程，產生並儲存草稿後即可排程發布。</p></div>';
    return;
  }
  container.className = 'record-list';
  container.innerHTML = state.schedule.slice(0, 8).map((item) => {
    const post = state.posts.find((record) => record.id === item.postId);
    const name = escapeHtml(post ? (post.title || post.internalTitle || post.contentTopic || post.godName || '未命名內容') : '未命名內容');
    const status = targetStatusLabel(item.status);
    const error = item.lastError?.message ? ' title="' + escapeHtml(item.lastError.message) + '"' : '';
    const attempts = item.attempts > 1 ? ' · 第 ' + item.attempts + ' 次' : '';
    const channel = PLATFORM_NAMES[item.channel] || item.channel || '未指定平台';
    const account = state.accounts.find((entry) => entry.id === item.accountId);
    const accountName = account?.name || PLATFORM_NAMES[item.channel] || item.channel || '未指定平台';
    const platform = state.platforms.find((entry) => entry.id === item.channel);
    const contentType = platform?.contentTypes?.find((entry) => entry.id === item.contentType);
    const format = contentType?.name || item.contentType || '貼文';
    const mode = item.scheduleMode === 'queue' ? ' ・ 佇列' : '';
    return '<div class="schedule-card" id="schedule-item-' + escapeHtml(item.targetId) + '"' + error + '><span class="calendar-icon">' + new Date(item.scheduledAt).getDate() + '</span><span><strong>' + name + '</strong><small>' + escapeHtml(channel) + ' ・ ' + escapeHtml(accountName) + ' ・ ' + escapeHtml(format) + mode + ' ・ ' + formatDate(item.scheduledAt) + attempts + '</small></span><em data-status="' + escapeHtml(item.status) + '">' + escapeHtml(status) + '</em>' + scheduleActions(item) + '</div>';
  }).join('');
}

export function initCalendarControls(refreshListsFn) {
  $('#calendarPrevious')?.addEventListener('click', () => {
    if (calendarView === 'week') calendarCursor.setDate(calendarCursor.getDate() - 7);
    else calendarCursor.setMonth(calendarCursor.getMonth() - 1);
    renderCalendarGrid();
  });
  $('#calendarNext')?.addEventListener('click', () => {
    if (calendarView === 'week') calendarCursor.setDate(calendarCursor.getDate() + 7);
    else calendarCursor.setMonth(calendarCursor.getMonth() + 1);
    renderCalendarGrid();
  });
  $('#calendarToday')?.addEventListener('click', () => {
    calendarCursor = new Date();
    calendarCursor.setHours(0, 0, 0, 0);
    renderCalendarGrid();
  });
  document.querySelectorAll('input[name="calendarView"]').forEach((input) => input.addEventListener('change', () => {
    calendarView = input.value;
    renderCalendarGrid();
  }));
  $('#calendarGrid')?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-calendar-target-id]');
    if (!item) return;
    document.getElementById('schedule-item-' + item.dataset.calendarTargetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('#calendarGrid')?.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-calendar-target-id][draggable="true"]');
    if (!item) return;
    draggedTargetId = item.dataset.calendarTargetId || '';
    event.dataTransfer?.setData('text/plain', draggedTargetId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    item.classList.add('is-dragging');
  });
  $('#calendarGrid')?.addEventListener('dragend', (event) => {
    event.target.closest('[data-calendar-target-id]')?.classList.remove('is-dragging');
    document.querySelectorAll('.calendar-day.is-drop-target').forEach((day) => day.classList.remove('is-drop-target'));
    draggedTargetId = '';
  });
  $('#calendarGrid')?.addEventListener('dragover', (event) => {
    const day = event.target.closest('[data-calendar-date]');
    if (!day || !draggedTargetId) return;
    event.preventDefault();
    day.classList.add('is-drop-target');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });
  $('#calendarGrid')?.addEventListener('dragleave', (event) => {
    const day = event.target.closest('[data-calendar-date]');
    if (day && !day.contains(event.relatedTarget)) day.classList.remove('is-drop-target');
  });
  $('#calendarGrid')?.addEventListener('drop', async (event) => {
    const day = event.target.closest('[data-calendar-date]');
    const targetId = draggedTargetId || event.dataTransfer?.getData('text/plain');
    if (!day || !targetId) return;
    event.preventDefault();
    day.classList.remove('is-drop-target');
    const item = state.schedule.find((entry) => entry.targetId === targetId);
    if (!item?.scheduledAt) return;
    const original = new Date(item.scheduledAt);
    if (Number.isNaN(original.getTime())) return;
    const local = new Date(original.getTime() - original.getTimezoneOffset() * 60000);
    const scheduledLocal = day.dataset.calendarDate + 'T' + local.toISOString().slice(11, 16);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
    try {
      await api('/api/schedule/' + encodeURIComponent(targetId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: new Date(scheduledLocal).toISOString(),
          scheduledLocal,
          timeZone,
          scheduleTimeZone: timeZone,
          scheduleMode: 'manual',
        }),
      });
      if (typeof refreshListsFn === 'function') await refreshListsFn();
      showToast('已更新排程日期。', 'success');
    } catch (error) {
      renderCalendarGrid();
      showToast(error.message || '拖曳改期失敗。', 'error');
    }
  });
  renderCalendarGrid();
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
      if (button.dataset.scheduleAction === 'first-comment-retry') {
        try {
          button.disabled = true;
          await api('/api/publish/target/first-comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId: item.postId || button.dataset.postId, targetId: item.targetId }),
          });
          if (typeof refreshListsFn === 'function') await refreshListsFn();
          showToast('首則留言已重新送出。', 'success');
        } catch (error) {
          if (typeof refreshListsFn === 'function') await refreshListsFn();
          showToast(error.message || '首則留言重試失敗。', 'error');
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
      setScheduleMode('manual', { locked: true });
      dialog.showModal();
    });
  }

  const scheduleBtn = $('#scheduleButton');
  if (scheduleBtn) {
    scheduleBtn.addEventListener('click', () => {
      reschedulingItem = null;
      if (!state.savedPost) return setPreviewMessage('請先儲存草稿，再安排時間。', 'error');
      if (state.editorDirty) return setPreviewMessage('內容有未儲存變更，請先儲存草稿。', 'error');
      const dialog = $('#scheduleDialog');
      const now = new Date(Date.now() + 60 * 60 * 1000);
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      $('#scheduledAt').value = now.toISOString().slice(0, 16);
      const activeAccount = (currentClient()?.accounts || state.accounts || []).find((item) => item.id === state.activeTargetId);
      const channel = activeAccount?.platformId || 'facebook';
      setFieldValue($('#scheduleChannel'), channel);
      renderAccountOptions(channel);
      if (activeAccount?.id && $('#scheduleAccount')) $('#scheduleAccount').value = activeAccount.id;
      renderContentTypeOptions(channel);
      setScheduleMode('manual', { locked: false });
      dialog.showModal();
    });
  }

  const channelSel = $('#scheduleChannel');
  if (channelSel) {
    channelSel.addEventListener('change', (event) => {
      renderAccountOptions(event.target.value);
      renderContentTypeOptions(event.target.value);
      renderContentSettings(event.target.value, fieldValue($('#scheduleContentType')));
    });
  }

  document.querySelectorAll('input[name="scheduleMode"]').forEach((input) => input.addEventListener('change', () => {
    renderContentSettings(fieldValue($('#scheduleChannel')), fieldValue($('#scheduleContentType')));
  }));

  const contentTypeSel = $('#scheduleContentType');
  if (contentTypeSel) {
    contentTypeSel.addEventListener('change', (event) => renderContentSettings(fieldValue($('#scheduleChannel')), event.target.value));
  }

  const form = $('#scheduleForm');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const mode = fieldValue($('#scheduleMode')) || 'manual';
        const scheduledLocal = $('#scheduledAt').value;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
        const scheduledAt = scheduledLocal ? new Date(scheduledLocal).toISOString() : '';
        const isRescheduling = Boolean(reschedulingItem);
        const channel = fieldValue($('#scheduleChannel')) || 'facebook';
        if (isRescheduling) {
          await api('/api/schedule/' + encodeURIComponent(reschedulingItem.targetId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduledAt, scheduledLocal, timeZone, scheduleMode: 'manual' }),
          });
        } else {
          const activeTarget = getActiveTarget();
          await api('/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId: state.savedPost.id,
              targetId: activeTarget?.id || undefined,
              ...(mode === 'manual' ? { scheduledAt, scheduledLocal, timeZone } : {}),
              scheduleMode: mode,
              channel,
              accountId: activeTarget?.accountId || $('#scheduleAccount').value || state.activeTargetId,
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
          : mode === 'queue'
            ? '已加入發布佇列，會使用下一個可用時段。'
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
