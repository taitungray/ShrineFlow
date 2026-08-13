import { $, escapeHtml, showToast } from './dom.js';
import { api } from './api.js';
import { state, setCurrentClientId, currentClient } from './state.js';

export function renderClientSwitcher() {
  const select = $('#currentClientSelect');
  if (!select) return;
  const clients = state.clients || [];
  if (!clients.length) {
    select.innerHTML = '<option value="">尚無客戶</option>';
    return;
  }
  if (!state.currentClientId || !clients.some((client) => client.id === state.currentClientId)) {
    setCurrentClientId(clients[0].id);
  }
  select.innerHTML = clients.map((client) => (
    '<option value="' + escapeHtml(client.id) + '"'
    + (client.id === state.currentClientId ? ' selected' : '')
    + '>' + escapeHtml(client.name) + '</option>'
  )).join('');
}

export function loadClientFacebookFields() {
  const client = currentClient();
  const facebook = (client?.accounts || []).find((account) => account.platformId === 'facebook');
  const pageId = $('#settingFacebookPageId');
  const token = $('#settingFacebookPageAccessToken');
  if (pageId) pageId.value = facebook?.credentials?.pageId || '';
  if (token) token.value = facebook?.credentials?.pageAccessToken || '';

  [
    ['instagram', 'settingInstagramUserId', 'settingInstagramAccessToken'],
    ['threads', 'settingThreadsUserId', 'settingThreadsAccessToken'],
  ].forEach(([platformId, userIdField, tokenField]) => {
    const account = (client?.accounts || []).find((item) => item.platformId === platformId);
    const userId = $('#' + userIdField);
    const accessToken = $('#' + tokenField);
    if (userId) userId.value = account?.credentials?.userId || '';
    if (accessToken) accessToken.value = account?.credentials?.accessToken || '';
  });
}

export function initClientListeners({ onClientChanged, onClientsUpdated } = {}) {
  const select = $('#currentClientSelect');
  if (select) {
    select.addEventListener('change', async () => {
      setCurrentClientId(select.value);
      loadClientFacebookFields();
      if (typeof onClientChanged === 'function') await onClientChanged();
    });
  }

  const createBtn = $('#btnCreateClient');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      const name = $('#newClientName')?.value?.trim();
      if (!name) return showToast('請輸入客戶名稱', 'error');
      try {
        const client = await api('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            notes: $('#newClientNotes')?.value || '',
          }),
        });
        state.clients = await api('/api/clients');
        setCurrentClientId(client.id);
        renderClientSwitcher();
        loadClientFacebookFields();
        $('#newClientName').value = '';
        if ($('#newClientNotes')) $('#newClientNotes').value = '';
        showToast('客戶已建立', 'success');
        if (typeof onClientsUpdated === 'function') await onClientsUpdated();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  const saveFb = $('#btnSaveClientFacebook');
  if (saveFb) {
    saveFb.addEventListener('click', async () => {
      const client = currentClient();
      if (!client) return showToast('請先選擇客戶', 'error');
      try {
        const pageId = $('#settingFacebookPageId')?.value?.trim() || '';
        const updated = await api('/api/clients/' + client.id + '/accounts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platformId: 'facebook',
            name: pageId ? `Facebook 粉專（${pageId}）` : 'Facebook 粉專',
            credentials: {
              pageId,
              pageAccessToken: $('#settingFacebookPageAccessToken')?.value || '',
            },
          }),
        });
        state.clients = state.clients.map((item) => (item.id === updated.id ? updated : item));
        if (!state.clients.some((item) => item.id === updated.id)) state.clients.push(updated);
        showToast('客戶 Facebook 連線已儲存', 'success');
        if (typeof onClientsUpdated === 'function') await onClientsUpdated();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  [
    {
      platformId: 'instagram',
      label: 'Instagram',
      buttonId: 'btnSaveClientInstagram',
      userIdField: 'settingInstagramUserId',
      tokenField: 'settingInstagramAccessToken',
    },
    {
      platformId: 'threads',
      label: 'Threads',
      buttonId: 'btnSaveClientThreads',
      userIdField: 'settingThreadsUserId',
      tokenField: 'settingThreadsAccessToken',
    },
  ].forEach(({ platformId, label, buttonId, userIdField, tokenField }) => {
    const saveButton = $('#' + buttonId);
    if (!saveButton) return;
    saveButton.addEventListener('click', async () => {
      const client = currentClient();
      if (!client) return showToast('請先選擇客戶', 'error');
      try {
        const existing = (client.accounts || []).find((account) => account.platformId === platformId);
        const userId = $('#' + userIdField)?.value?.trim() || '';
        const updated = await api('/api/clients/' + client.id + '/accounts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(existing?.id ? { id: existing.id } : {}),
            platformId,
            name: userId ? `${label}（${userId}）` : label,
            credentials: {
              userId,
              accessToken: $('#' + tokenField)?.value || '',
            },
          }),
        });
        state.clients = state.clients.map((item) => (item.id === updated.id ? updated : item));
        if (!state.clients.some((item) => item.id === updated.id)) state.clients.push(updated);
        loadClientFacebookFields();
        showToast(`客戶 ${label} 連線已儲存`, 'success');
        if (typeof onClientsUpdated === 'function') await onClientsUpdated();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  });
}
