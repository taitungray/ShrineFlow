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

  const ig = (client?.accounts || []).find((account) => account.platformId === 'instagram');
  const line = (client?.accounts || []).find((account) => account.platformId === 'line');
  const igName = $('#placeholderIgName');
  const lineName = $('#placeholderLineName');
  if (igName) igName.value = ig?.name || '';
  if (lineName) lineName.value = line?.name || '';
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
        showToast('客戶 Facebook 帳號已儲存', 'success');
        if (typeof onClientsUpdated === 'function') await onClientsUpdated();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  const savePlaceholders = $('#btnSavePlaceholderAccounts');
  if (savePlaceholders) {
    savePlaceholders.addEventListener('click', async () => {
      const client = currentClient();
      if (!client) return showToast('請先選擇客戶', 'error');
      try {
        const igName = $('#placeholderIgName')?.value?.trim();
        const lineName = $('#placeholderLineName')?.value?.trim();
        if (igName) {
          await api('/api/clients/' + client.id + '/accounts', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: 'instagram:default',
              platformId: 'instagram',
              name: igName,
              configured: false,
              enabled: false,
              credentials: {},
            }),
          });
        }
        if (lineName) {
          await api('/api/clients/' + client.id + '/accounts', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: 'line:default',
              platformId: 'line',
              name: lineName,
              configured: false,
              enabled: false,
              credentials: {},
            }),
          });
        }
        state.clients = await api('/api/clients');
        showToast('預留帳號已儲存', 'success');
        if (typeof onClientsUpdated === 'function') await onClientsUpdated();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }
}
