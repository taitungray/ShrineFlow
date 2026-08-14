import { $, escapeHtml, showToast } from './dom.js';
import { api } from './api.js';
import { currentClient, hasPermission, state } from './state.js';

const WEEKDAYS = [
  [1, '週一'], [2, '週二'], [3, '週三'], [4, '週四'],
  [5, '週五'], [6, '週六'], [7, '週日'],
];

let initialized = false;

function accountsForCurrentClient() {
  return (currentClient()?.accounts || []).filter((account) => account.enabled !== false);
}

function emptyQueue(account) {
  return {
    clientId: currentClient()?.id || '',
    accountId: account?.id || '',
    accountName: account?.name || '',
    platformId: account?.platformId || '',
    queue: {
      id: account?.id ? `queue-${account.id}` : '',
      enabled: false,
      paused: false,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei',
      slots: [],
    },
  };
}

function accountOptions(selectedId) {
  return accountsForCurrentClient().map((account) => '<option value="'
    + escapeHtml(account.id) + '"' + (account.id === selectedId ? ' selected' : '') + '>'
    + escapeHtml(account.name || account.id) + ' · ' + escapeHtml(account.platformId || '') + '</option>').join('');
}

function slotMarkup(slot = {}) {
  const weekdayOptions = WEEKDAYS.map(([value, label]) => '<option value="' + value + '"'
    + (Number(slot.weekday) === value ? ' selected' : '') + '>' + label + '</option>').join('');
  return '<div class="queue-slot-row" data-queue-slot>'
    + '<select data-queue-weekday aria-label="佇列星期">' + weekdayOptions + '</select>'
    + '<input type="time" data-queue-time value="' + escapeHtml(slot.localTime || '09:00') + '" aria-label="佇列時間" />'
    + '<button class="btn-text schedule-action-danger" type="button" data-queue-remove aria-label="移除時段">移除</button>'
    + '</div>';
}

export function renderQueueSettings() {
  const card = $('#queueSettingsCard');
  if (!card) return;
  const accounts = accountsForCurrentClient();
  const current = state.queueSettings || emptyQueue(accounts[0]);
  const queue = current.queue || emptyQueue(accounts[0]).queue;
  const accountSelect = $('#queueAccount');
  const enabled = $('#queueEnabled');
  const paused = $('#queuePaused');
  const timeZone = $('#queueTimeZone');
  const slots = $('#queueSlots');
  if (accountSelect) {
    accountSelect.innerHTML = accountOptions(current.accountId || accounts[0]?.id || '');
    accountSelect.disabled = !accounts.length;
  }
  if (enabled) enabled.checked = Boolean(queue.enabled);
  if (paused) paused.checked = Boolean(queue.paused);
  if (timeZone) timeZone.value = queue.timeZone || 'Asia/Taipei';
  if (slots) {
    slots.innerHTML = queue.slots?.length
      ? queue.slots.map(slotMarkup).join('')
      : '<p class="helper queue-empty-slots">尚未設定固定時段，請新增至少一個時段。</p>';
  }
  const save = $('#queueSaveButton');
  if (save) save.disabled = !accounts.length || !hasPermission('schedule.manage');
  const message = $('#queueStatus');
  if (message && current.error) message.textContent = current.error;
  if (!accounts.length) {
    card.classList.add('is-empty');
    if (message) message.textContent = '請先設定平台連線，再建立發布佇列。';
  } else {
    card.classList.remove('is-empty');
  }
}

export async function loadQueueSettings() {
  const accounts = accountsForCurrentClient();
  if (!accounts.length || !currentClient()?.id) {
    state.queueSettings = emptyQueue(accounts[0]);
    renderQueueSettings();
    return state.queueSettings;
  }
  const accountId = state.queueSettings?.accountId && accounts.some((account) => account.id === state.queueSettings.accountId)
    ? state.queueSettings.accountId
    : accounts[0].id;
  try {
    state.queueSettings = await api('/api/queues?clientId=' + encodeURIComponent(currentClient().id)
      + '&accountId=' + encodeURIComponent(accountId));
  } catch (error) {
    state.queueSettings = { ...emptyQueue(accounts.find((account) => account.id === accountId)), error: error.message };
  }
  renderQueueSettings();
  return state.queueSettings;
}

function readSlots() {
  return [...document.querySelectorAll('[data-queue-slot]')].map((row) => ({
    weekday: Number(row.querySelector('[data-queue-weekday]')?.value || 1),
    localTime: row.querySelector('[data-queue-time]')?.value || '',
    enabled: true,
  }));
}

export function initQueueSettings() {
  if (initialized) return;
  initialized = true;
  $('#queueAccount')?.addEventListener('change', () => {
    const account = accountsForCurrentClient().find((item) => item.id === $('#queueAccount')?.value);
    state.queueSettings = emptyQueue(account);
    loadQueueSettings();
  });
  $('#queueAddSlot')?.addEventListener('click', () => {
    const container = $('#queueSlots');
    if (!container) return;
    container.querySelector('.queue-empty-slots')?.remove();
    container.insertAdjacentHTML('beforeend', slotMarkup({ weekday: 1, localTime: '09:00' }));
  });
  $('#queueSlots')?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-queue-remove]');
    if (!remove) return;
    remove.closest('[data-queue-slot]')?.remove();
  });
  $('#queueForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const accountId = $('#queueAccount')?.value || '';
    const message = $('#queueStatus');
    if (!accountId) return;
    const button = $('#queueSaveButton');
    if (button) button.disabled = true;
    if (message) message.textContent = '儲存中…';
    try {
      state.queueSettings = await api('/api/queues', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: currentClient()?.id,
          accountId,
          enabled: Boolean($('#queueEnabled')?.checked),
          paused: Boolean($('#queuePaused')?.checked),
          timeZone: $('#queueTimeZone')?.value || 'Asia/Taipei',
          slots: readSlots(),
        }),
      });
      renderQueueSettings();
      showToast('發布佇列設定已儲存。', 'success');
      if (message) message.textContent = '已儲存；新的內容會使用下一個可用時段。';
    } catch (error) {
      if (message) message.textContent = error.message || '儲存失敗。';
      showToast(error.message || '儲存失敗。', 'error');
    } finally {
      if (button) button.disabled = !hasPermission('schedule.manage');
    }
  });
  renderQueueSettings();
}
