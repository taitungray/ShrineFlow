import { $, setFormMessage, showToast } from './dom.js';
import { api } from './api.js';
import { currentClient } from './state.js';
import { loadClientFacebookFields } from './clients-ui.js';

export async function loadSettings() {
  try {
    const data = await api('/api/settings');
    const geminiKey = $('#settingGeminiApiKey');
    if (geminiKey) geminiKey.value = data.geminiApiKey || '';
    const geminiModel = $('#settingGeminiModel');
    if (geminiModel) geminiModel.value = data.geminiModel || 'gemini-3.6-flash';
    const geminiFallbacks = $('#settingGeminiFallbackModels');
    if (geminiFallbacks) geminiFallbacks.value = data.geminiFallbackModels || 'gemini-2.5-flash';
    const graphVersion = $('#settingMetaGraphVersion');
    if (graphVersion) graphVersion.value = data.metaGraphVersion || 'v25.0';
    const publicMediaBaseUrl = $('#settingPublicMediaBaseUrl');
    if (publicMediaBaseUrl) publicMediaBaseUrl.value = data.publicMediaBaseUrl || '';
    loadClientFacebookFields();
  } catch (error) {
    showToast('無法載入系統設定：' + error.message, 'error');
  }
}

export function initSettingsListeners(onSettingsSavedFn) {
  const toggleGeminiKey = $('#toggleGeminiKey');
  if (toggleGeminiKey) {
    toggleGeminiKey.addEventListener('click', () => {
      const input = $('#settingGeminiApiKey');
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      toggleGeminiKey.textContent = isPassword ? '隱藏' : '顯示';
    });
  }

  const toggleFbToken = $('#toggleFbToken');
  if (toggleFbToken) {
    toggleFbToken.addEventListener('click', () => {
      const input = $('#settingFacebookPageAccessToken');
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      toggleFbToken.textContent = isPassword ? '隱藏' : '顯示';
    });
  }

  [
    ['toggleInstagramToken', 'settingInstagramAccessToken'],
    ['toggleThreadsToken', 'settingThreadsAccessToken'],
  ].forEach(([buttonId, inputId]) => {
    const button = $('#' + buttonId);
    if (!button) return;
    button.addEventListener('click', () => {
      const input = $('#' + inputId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      button.textContent = isPassword ? '隱藏' : '顯示';
    });
  });

  const btnTestGemini = $('#btnTestGemini');
  if (btnTestGemini) {
    btnTestGemini.addEventListener('click', async () => {
      const msg = $('#testGeminiResult');
      if (msg) msg.textContent = '連線測試中…';
      try {
        const res = await api('/api/settings/test-gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: $('#settingGeminiApiKey')?.value || '',
            model: $('#settingGeminiModel')?.value || '',
          }),
        });
        if (msg) {
          msg.textContent = res.message;
          msg.className = 'helper text-success';
        }
        showToast(res.message, 'success');
      } catch (error) {
        if (msg) {
          msg.textContent = error.message;
          msg.className = 'helper text-danger';
        }
        showToast(error.message, 'error');
      }
    });
  }

  const btnTestFacebook = $('#btnTestFacebook');
  if (btnTestFacebook) {
    btnTestFacebook.addEventListener('click', async () => {
      const msg = $('#testFacebookResult');
      if (msg) msg.textContent = '連線測試中…';
      try {
        const client = currentClient();
        const facebook = (client?.accounts || []).find((account) => account.platformId === 'facebook');
        if (client && facebook?.id) {
          const res = await api('/api/clients/' + client.id + '/accounts/' + encodeURIComponent(facebook.id) + '/test', {
            method: 'POST',
          });
          const message = res.connected
            ? ('連線成功' + (res.page?.name ? '：' + res.page.name : ''))
            : (res.error || '連線失敗');
          if (msg) {
            msg.textContent = message;
            msg.className = res.connected ? 'helper text-success' : 'helper text-danger';
          }
          showToast(message, res.connected ? 'success' : 'error');
          return;
        }

        const res = await api('/api/settings/test-facebook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId: $('#settingFacebookPageId')?.value || '',
            pageAccessToken: $('#settingFacebookPageAccessToken')?.value || '',
            graphVersion: $('#settingMetaGraphVersion')?.value || '',
          }),
        });
        if (msg) {
          msg.textContent = res.message;
          msg.className = 'helper text-success';
        }
        showToast(res.message, 'success');
      } catch (error) {
        if (msg) {
          msg.textContent = error.message;
          msg.className = 'helper text-danger';
        }
        showToast(error.message, 'error');
      }
    });
  }

  [
    ['instagram', 'Instagram', 'btnTestInstagram', 'testInstagramResult'],
    ['threads', 'Threads', 'btnTestThreads', 'testThreadsResult'],
  ].forEach(([platformId, label, buttonId, resultId]) => {
    const button = $('#' + buttonId);
    if (!button) return;
    button.addEventListener('click', async () => {
      const msg = $('#' + resultId);
      if (msg) msg.textContent = '連線測試中…';
      try {
        const client = currentClient();
        const account = (client?.accounts || []).find((item) => item.platformId === platformId);
        if (!client || !account?.id) {
          throw new Error(`請先儲存此客戶的 ${label} 帳號。`);
        }
        const res = await api(
          '/api/clients/' + client.id + '/accounts/' + encodeURIComponent(account.id) + '/test',
          { method: 'POST' },
        );
        const identity = res.profile?.username || res.profile?.id || '';
        const message = res.connected
          ? ('連線成功' + (identity ? '：' + identity : ''))
          : (res.error || '連線失敗');
        if (msg) {
          msg.textContent = message;
          msg.className = res.connected ? 'helper text-success' : 'helper text-danger';
        }
        showToast(message, res.connected ? 'success' : 'error');
      } catch (error) {
        if (msg) {
          msg.textContent = error.message;
          msg.className = 'helper text-danger';
        }
        showToast(error.message, 'error');
      }
    });
  });

  const form = $('#settingsForm');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const payload = {
          geminiApiKey: $('#settingGeminiApiKey')?.value || '',
          geminiModel: $('#settingGeminiModel')?.value || '',
          geminiFallbackModels: $('#settingGeminiFallbackModels')?.value || '',
          metaGraphVersion: $('#settingMetaGraphVersion')?.value || '',
          publicMediaBaseUrl: $('#settingPublicMediaBaseUrl')?.value || '',
        };
        const res = await api('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast(res.message || '系統設定已儲存', 'success');
        if (typeof onSettingsSavedFn === 'function') await onSettingsSavedFn();
      } catch (error) {
        showToast('儲存失敗：' + error.message, 'error');
      }
    });
  }
}
