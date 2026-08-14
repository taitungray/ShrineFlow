import { $, escapeHtml, showToast } from './dom.js';
import { api } from './api.js';
import { state, setCurrentClientId, currentClient } from './state.js';

export function renderClientSwitcher() {
  const select = $('#currentClientSelect');
  if (!select) return;
  const clients = state.clients || [];
  if (!clients.length) {
    select.innerHTML = '<option value="">尚無品牌</option>';
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
  const facebookExpiry = $('#settingFacebookTokenExpiresAt');
  if (pageId) pageId.value = facebook?.credentials?.pageId || '';
  if (token) token.value = facebook?.credentials?.pageAccessToken || '';
  if (facebookExpiry) facebookExpiry.value = facebook?.tokenExpiresAt?.slice(0, 10) || '';

  [
    ['instagram', 'settingInstagramUserId', 'settingInstagramAccessToken'],
    ['threads', 'settingThreadsUserId', 'settingThreadsAccessToken'],
  ].forEach(([platformId, userIdField, tokenField]) => {
    const account = (client?.accounts || []).find((item) => item.platformId === platformId);
    const userId = $('#' + userIdField);
    const accessToken = $('#' + tokenField);
    const expiry = $('#' + (platformId === 'instagram' ? 'settingInstagramTokenExpiresAt' : 'settingThreadsTokenExpiresAt'));
    if (userId) userId.value = account?.credentials?.userId || '';
    if (accessToken) accessToken.value = account?.credentials?.accessToken || '';
    if (expiry) expiry.value = account?.tokenExpiresAt?.slice(0, 10) || '';
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
      if (!name) return showToast('請輸入品牌名稱', 'error');
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
        showToast('品牌已建立', 'success');
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
      if (!client) return showToast('請先選擇品牌', 'error');
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
            tokenExpiresAt: $('#settingFacebookTokenExpiresAt')?.value || '',
          }),
        });
        state.clients = state.clients.map((item) => (item.id === updated.id ? updated : item));
        if (!state.clients.some((item) => item.id === updated.id)) state.clients.push(updated);
        showToast('品牌 Facebook 連線已儲存', 'success');
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
      expiryField: 'settingInstagramTokenExpiresAt',
    },
    {
      platformId: 'threads',
      label: 'Threads',
      buttonId: 'btnSaveClientThreads',
      userIdField: 'settingThreadsUserId',
      tokenField: 'settingThreadsAccessToken',
      expiryField: 'settingThreadsTokenExpiresAt',
    },
  ].forEach(({ platformId, label, buttonId, userIdField, tokenField, expiryField }) => {
    const saveButton = $('#' + buttonId);
    if (!saveButton) return;
    saveButton.addEventListener('click', async () => {
      const client = currentClient();
      if (!client) return showToast('請先選擇品牌', 'error');
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
            tokenExpiresAt: $('#' + expiryField)?.value || '',
          }),
        });
        state.clients = state.clients.map((item) => (item.id === updated.id ? updated : item));
        if (!state.clients.some((item) => item.id === updated.id)) state.clients.push(updated);
        loadClientFacebookFields();
        showToast(`品牌 ${label} 連線已儲存`, 'success');
        if (typeof onClientsUpdated === 'function') await onClientsUpdated();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  });
}
