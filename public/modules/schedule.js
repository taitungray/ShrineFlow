import { $, escapeHtml, formatDate, setPreviewMessage, showToast, fieldValue, setFieldValue, bindDialogDismiss, isVideoPath } from './dom.js';
import { state, PLATFORM_NAMES, currentClient, mediaPathsOf, clientQuery } from './state.js';
import { renderAccountOptions, renderContentTypeOptions, renderContentSettings, readContentSettings } from './platform-ui.js';
import { api, createIdempotencyKey } from './api.js';
import { publishTargetWithRecovery } from './long-task.js';
import { getActiveTarget } from './targets-ui.js';
import { targetStatusLabel } from './status.js';
import { humanizePlatformError } from './platform-errors.js';
import { previewMediaSrc } from './media-preview.js';
import { loadPost, runPostAction } from './drafts.js';
import { platformChipHtml } from './platform-icon.js';
import { LIST_PAGE_SIZE, paginate, removeListPager, syncListPager } from './pagination.js';
import { agendaItemsForView, dateKey } from './calendar-agenda.js';

let reschedulingItem = null;
let draggedTargetId = '';
let calendarView = 'month';
let schedulePage = 1;
let selectedCalendarDate = '';
let selectedCalendarTargetId = '';
let calendarCursor = new Date();
calendarCursor.setHours(0, 0, 0, 0);

const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function setScheduleFormMessage(message = '', type = '') {
  const el = $('#scheduleFormMessage');
  if (!el) return;
  el.textContent = humanizePlatformError(message) || String(message || '');
  el.dataset.type = type;
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

function visibleCalendarDays() {
  const days = [];
  if (calendarView === 'week') {
    const start = startOfWeek(calendarCursor);
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      days.push(date);
    }
    return days;
  }
  const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() || 7) - 1));
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    days.push(date);
  }
  return days;
}

function scheduleListItems() {
  return agendaItemsForView(state.schedule, {
    view: calendarView,
    selectedDate: selectedCalendarDate,
    visibleDateKeys: new Set(visibleCalendarDays().map(dateKey)),
  });
}

function clearCalendarSelection() {
  selectedCalendarDate = '';
  selectedCalendarTargetId = '';
}

function schedulePostTitle(post) {
  return post?.title || post?.internalTitle || post?.contentTopic || post?.godName || '未命名內容';
}

function schedulePostText(post) {
  return String(post?.facebook || post?.text || post?.reel || '').trim();
}

function renderCalendarTokenNotice() {
  const notice = $('#calendarConnectionNotice');
  if (!notice) return;
  const error = String(state.facebookStatus?.error || '');
  const expired = /Token 已過期|expired access token|session has expired/i.test(error);
  notice.classList.toggle('is-hidden', !expired);
  if (!expired) {
    notice.innerHTML = '';
    return;
  }
  notice.innerHTML = 'Facebook Token 已過期，取消／改時間會失敗。可先隱藏本機紀錄，或<a href="#/settings/facebook">更新粉專 Token</a>。';
}

function calendarItemMarkup(item) {
  const post = state.posts.find((record) => record.id === item.postId);
  const title = schedulePostTitle(post);
  const channel = PLATFORM_NAMES[item.channel] || item.channel || '平台';
  const draggable = item.status === 'scheduled' ? ' draggable="true"' : '';
  const selected = item.targetId === selectedCalendarTargetId ? ' is-selected' : '';
  const platformSrc = ['facebook', 'instagram', 'threads'].includes(item.channel)
    ? '<img class="calendar-item-platform" data-platform="' + escapeHtml(item.channel) + '" src="/icons/' + escapeHtml(item.channel) + '.svg" alt="" width="14" height="14" />'
    : '';
  return '<button class="calendar-item' + selected + '" type="button"' + draggable + ' data-calendar-target-id="' + escapeHtml(item.targetId) + '" data-status="' + escapeHtml(item.status || 'draft') + '" aria-label="' + escapeHtml(channel + ' · ' + title) + '">' +
    platformSrc + '<span class="calendar-item-title">' + escapeHtml(title) + '</span></button>';
}

function renderCalendarGrid() {
  const grid = $('#calendarGrid');
  const panel = $('#schedulePanel');
  const label = $('#calendarMonthLabel');
  if (!grid || !panel) return;
  panel.dataset.calendarView = calendarView;
  if (selectedCalendarDate && calendarView !== 'list') panel.dataset.selectedDate = selectedCalendarDate;
  else delete panel.dataset.selectedDate;
  grid.className = 'calendar-grid calendar-grid-' + calendarView;

  if (calendarView === 'list') {
    grid.innerHTML = '';
    if (label) label.textContent = '發布列表';
    return;
  }

  const days = visibleCalendarDays();
  const start = days[0];

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
        key === selectedCalendarDate ? 'is-selected' : '',
        calendarView === 'month' && date.getMonth() !== currentMonth ? 'is-outside' : '',
      ].filter(Boolean).join(' ');
      return '<div class="' + classes + '" data-calendar-date="' + escapeHtml(key) + '">'
        + '<div class="calendar-day-header">'
        + '<span class="calendar-day-number">' + date.getDate() + '</span>'
        + '<button class="calendar-day-add" type="button" data-schedule-quick-add="' + escapeHtml(key) + '" title="排程此日">＋</button>'
        + '</div>'
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
      '<button class="content-card-action" type="button" data-schedule-action="reschedule" data-target-id="'
      + escapeHtml(item.targetId) + '">改時間</button>',
      '<button class="content-card-action schedule-action-danger" type="button" data-schedule-action="cancel" data-target-id="'
      + escapeHtml(item.targetId) + '">取消</button>',
      item.postId
        ? '<button class="content-card-action" type="button" data-post-action="hide" data-post-id="'
          + escapeHtml(item.postId) + '">隱藏</button>'
        : '',
    );
  }
  const retryBlocked = ['REMOTE_PUBLISH_RECONCILIATION_REQUIRED', 'REMOTE_SCHEDULE_RECONCILIATION_REQUIRED']
    .includes(item.lastError?.code);
  if (!retryBlocked && (item.status === 'failed' || item.status === 'retrying')) {
    buttons.push(
      '<button class="content-card-action" type="button" data-schedule-action="retry" data-target-id="'
      + escapeHtml(item.targetId) + '" data-post-id="'
      + escapeHtml(item.postId) + '">重發</button>',
    );
  }
  const firstComment = item.channel === 'instagram' && item.firstComment?.text
    ? item.firstComment.status === 'failed'
      ? '<button class="content-card-action schedule-action-danger" type="button" data-schedule-action="first-comment-retry" data-target-id="'
        + escapeHtml(item.targetId) + '" data-post-id="' + escapeHtml(item.postId || '') + '">重試首則留言</button>'
      : item.firstComment.status === 'pending'
        ? '<span class="schedule-child-status">首則留言處理中</span>'
        : item.firstComment.status === 'published'
          ? '<span class="schedule-child-status is-success">首則留言已發布</span>'
          : ''
    : '';
  if (!buttons.length && !firstComment) return '';
  return '<span class="content-card-actions">' + buttons.filter(Boolean).join('') + firstComment + '</span>';
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
  renderCalendarTokenNotice();
  const heading = document.querySelector('#schedulePanel .calendar-list-heading h3');
  if (heading) {
    heading.textContent = selectedCalendarDate && calendarView !== 'list'
      ? calendarLabel(new Date(selectedCalendarDate + 'T12:00:00')) + ' 發布行程'
      : '發布行程';
  }
  const items = scheduleListItems();
  if (!items.length) {
    removeListPager(container);
    container.className = 'list-empty';
    const emptyText = selectedCalendarDate && calendarView !== 'list'
      ? '這天沒有排程。'
      : (state.schedule.length ? '這個日期範圍沒有排程。' : '還沒有排程，產生並儲存草稿後即可排程發布。');
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📅</span><p>'
      + emptyText
      + '</p></div>';
    return;
  }
  const paged = paginate(items, { page: schedulePage, pageSize: LIST_PAGE_SIZE });
  schedulePage = paged.page;
  container.className = 'record-list content-list';
  container.innerHTML = paged.items.map((item) => {
    const post = state.posts.find((record) => record.id === item.postId) || {};
    const firstMedia = previewMediaSrc(mediaPathsOf(post)[0] || item.mediaPaths?.[0]);
    const thumbnail = !firstMedia ? '<span aria-hidden="true">✦</span>'
      : isVideoPath(firstMedia)
        ? '<video src="' + escapeHtml(firstMedia) + '" muted playsinline preload="metadata"></video>'
        : '<img src="' + escapeHtml(firstMedia) + '" alt="" />';
    const text = schedulePostText(post);
    const excerpt = escapeHtml(text.slice(0, 92)) + (text.length > 92 ? '…' : '');
    const status = String(item.status || 'draft');
    const updated = post.updatedAt || post.createdAt || item.createdAt;
    const meta = [
      updated ? formatDate(updated) : '',
      item.scheduledAt ? '排程：' + formatDate(item.scheduledAt) : '',
    ].filter(Boolean).join(' · ');
    const platformChips = platformChipHtml(item.channel);
    const title = schedulePostTitle(post);
    const selectedClass = item.targetId === selectedCalendarTargetId ? ' is-selected' : '';
    return '<article class="record-card content-card' + selectedClass + '" id="schedule-item-' + escapeHtml(item.targetId) + '" data-status="' + escapeHtml(status) + '">'
      + '<button class="record-card-main" type="button" data-open-post="' + escapeHtml(item.postId || '') + '" aria-label="開啟貼文 ' + escapeHtml(title) + '">'
      + '<span class="record-thumb">' + thumbnail + '</span>'
      + '<span class="record-body"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(meta || '尚無更新時間') + '</small><span>'
      + (excerpt || '尚未填寫文案') + '</span><span class="content-platforms">' + platformChips + '</span></span>'
      + '</button>'
      + '<span class="content-card-side"><em class="content-status" data-status="' + escapeHtml(status) + '">'
      + escapeHtml(targetStatusLabel(status)) + '</em>' + scheduleActions(item) + '</span>'
      + '</article>';
  }).join('');
  container.querySelectorAll('[data-open-post]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.openPost) loadPost(button.dataset.openPost);
  }));
  container.querySelectorAll('[data-post-action]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    runPostAction(button.dataset.postAction, button.dataset.postId);
  }));
  syncListPager(container, paged, {
    label: '日曆列表分頁',
    onPage: (page) => {
      schedulePage = page;
      renderSchedule();
    },
  });
}

export function initCalendarControls(refreshListsFn) {
  $('#calendarPrevious')?.addEventListener('click', () => {
    if (calendarView === 'week') calendarCursor.setDate(calendarCursor.getDate() - 7);
    else calendarCursor.setMonth(calendarCursor.getMonth() - 1);
    clearCalendarSelection();
    renderSchedule();
  });
  $('#calendarNext')?.addEventListener('click', () => {
    if (calendarView === 'week') calendarCursor.setDate(calendarCursor.getDate() + 7);
    else calendarCursor.setMonth(calendarCursor.getMonth() + 1);
    clearCalendarSelection();
    renderSchedule();
  });
  $('#calendarToday')?.addEventListener('click', () => {
    calendarCursor = new Date();
    calendarCursor.setHours(0, 0, 0, 0);
    clearCalendarSelection();
    renderSchedule();
  });
  document.querySelectorAll('input[name="calendarView"]').forEach((input) => input.addEventListener('change', () => {
    calendarView = input.value;
    schedulePage = 1;
    if (calendarView === 'list') clearCalendarSelection();
    renderSchedule();
  }));
  $('#calendarGrid')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-schedule-quick-add]')) return;
    const item = event.target.closest('[data-calendar-target-id]');
    const day = event.target.closest('[data-calendar-date]');
    const targetId = item?.dataset.calendarTargetId || '';
    const fromItem = targetId
      ? state.schedule.find((entry) => entry.targetId === targetId)
      : null;
    const nextDate = fromItem
      ? dateKey(new Date(fromItem.scheduledAt))
      : (day?.dataset.calendarDate || '');
    if (!nextDate) return;
    selectedCalendarDate = nextDate;
    selectedCalendarTargetId = targetId;
    schedulePage = 1;
    renderSchedule();
    if (!targetId) return;
    requestAnimationFrame(() => {
      document.getElementById('schedule-item-' + targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
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
    bindDialogDismiss(dialog);
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
        if (button.dataset.busy === 'true') return;
        const platformName = PLATFORM_NAMES[item.channel] || item.channel;
        if (!window.confirm(`確定立刻重發「${platformName}」？`)) return;
        button.dataset.busy = 'true';
        button.disabled = true;
        try {
          showToast('重發中…', 'info');
          await publishTargetWithRecovery({
            api,
            postId: item.postId || button.dataset.postId,
            targetId: item.targetId,
            createIdempotencyKey,
            loadPost: async () => {
              const postId = item.postId || button.dataset.postId;
              const posts = await api(clientQuery('/api/posts'));
              return (Array.isArray(posts) ? posts : []).find((entry) => entry.id === postId) || null;
            },
          });
          if (typeof refreshListsFn === 'function') await refreshListsFn();
          showToast(`${platformName} 已重發成功。`, 'success');
        } catch (error) {
          if (typeof refreshListsFn === 'function') await refreshListsFn();
          showToast(error.message || '重發失敗。', 'error');
        } finally {
          button.dataset.busy = 'false';
          button.disabled = false;
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
      setScheduleFormMessage('');
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
      setScheduleFormMessage('');
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
      if (event.submitter?.value === 'cancel' || event.submitter?.classList.contains('close-button')) return;
      event.preventDefault();
      if (form.dataset.busy === 'true') return;
      const submit = $('#scheduleSubmitButton');
      form.dataset.busy = 'true';
      if (submit) {
        submit.disabled = true;
        submit.textContent = '排程中…';
      }
      try {
        const mode = fieldValue($('#scheduleMode')) || 'manual';
        const scheduledLocal = $('#scheduledAt').value;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
        const scheduledAt = scheduledLocal ? new Date(scheduledLocal).toISOString() : '';
        const isRescheduling = Boolean(reschedulingItem);
        const channel = fieldValue($('#scheduleChannel')) || 'facebook';
        const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() };
        if (isRescheduling) {
          await api('/api/schedule/' + encodeURIComponent(reschedulingItem.targetId), {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ scheduledAt, scheduledLocal, timeZone, scheduleMode: 'manual' }),
          });
        } else {
          const activeTarget = getActiveTarget();
          await api('/api/schedule', {
            method: 'POST',
            headers,
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
        setScheduleFormMessage(error.message, 'error');
        setPreviewMessage(error.message, 'error');
        showToast(error.message, 'error');
      } finally {
        form.dataset.busy = 'false';
        if (submit) {
          submit.textContent = '確認排程';
          renderContentSettings(fieldValue($('#scheduleChannel')), fieldValue($('#scheduleContentType')));
        }
      }
    });
  }

  const calendarGrid = $('#calendarGrid');
  calendarGrid?.addEventListener('click', (event) => {
    const quickAddBtn = event.target?.closest?.('[data-schedule-quick-add]');
    if (quickAddBtn) {
      const dateStr = quickAddBtn.dataset.scheduleQuickAdd;
      if (dateStr) {
        window.location.hash = '#/content/new';
        window.setTimeout(() => {
          const targetScheduleInput = $('#targetScheduledAt');
          if (targetScheduleInput) {
            targetScheduleInput.value = `${dateStr}T18:00`;
          }
          const topicInput = $('#contentTopic');
          if (topicInput) topicInput.focus();
        }, 120);
      }
    }
  });
}
