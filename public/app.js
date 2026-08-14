import { $, setFormMessage, showToast, fieldValue } from './modules/dom.js';
import { state, clientQuery, setCurrentClientId, currentClient } from './modules/state.js';
import { api } from './modules/api.js';
import { initTabs, setActiveView } from './modules/tabs.js';
import {
  renderPlatformOptions,
  renderAccountOptions,
  renderContentTypeOptions,
  renderCreatePublishSpec,
  renderCreateContentSettings,
} from './modules/platform-ui.js';
import {
  previewSelectedMedia,
  bindUploadReordering,
} from './modules/upload.js';
import {
  renderPreviewPlatformTabs,
  updateLivePreview,
  renderSavedMedia,
  renderGenerated,
  initEditorListeners,
} from './modules/editor.js';
import { renderPosts, initContentFilters } from './modules/drafts.js';
import { renderSchedule, initScheduleDialog, initCalendarControls } from './modules/schedule.js';
import { renderOverview } from './modules/overview.js';
import { renderMediaLibrary, initMediaLibrary } from './modules/media-library.js';
import { renderPublishingLogs, initPublishingLogs } from './modules/publishing-logs.js';
import { renderPlatformConnections } from './modules/platform-connections.js';
import { renderTemplates, initTemplateManager } from './modules/templates.js';
import { renderCampaigns, initCampaignManager } from './modules/campaigns.js';
import { renderInsights } from './modules/insights.js';
import { renderInbox } from './modules/inbox.js';
import { loadSettings, initSettingsListeners } from './modules/settings.js';
import { initSystemTools } from './modules/system.js';
import { renderClientSwitcher, initClientListeners, loadClientFacebookFields } from './modules/clients-ui.js';
import { renderTargetAccountControls, applyActiveTargetToEditor, initTargetListeners } from './modules/targets-ui.js';

async function refreshLists() {
  const [posts, schedule, templates, campaigns, insights, inbox] = await Promise.all([
    api(clientQuery('/api/posts')),
    api(clientQuery('/api/schedule')),
    api(clientQuery('/api/templates')),
    api(clientQuery('/api/campaigns')),
    api(clientQuery('/api/insights')).catch(() => ({ status: 'unavailable', sources: [] })),
    api(clientQuery('/api/inbox')).catch(() => ({ status: 'unavailable', sources: [] })),
  ]);
  state.posts = posts;
  state.schedule = schedule;
  state.templates = templates;
  state.campaigns = campaigns;
  state.insights = insights;
  state.inbox = inbox;
  renderPosts();
  renderSchedule();
  renderOverview();
  renderMediaLibrary();
  renderPublishingLogs();
  renderPlatformConnections();
  renderTemplates();
  renderCampaigns();
  renderInsights();
  renderInbox();
}

function applyClientAccounts() {
  const client = currentClient();
  state.accounts = (client?.accounts || []).map((account) => ({
    id: account.id,
    platformId: account.platformId,
    name: account.name,
    configured: Boolean(account.configured),
    enabled: account.enabled !== false,
  }));
  if (!state.accounts.length) {
    state.accounts = state.config?.publishingAccounts || [];
  }
  renderAccountOptions('facebook');
  renderTargetAccountControls();
  renderPreviewPlatformTabs();
  updateLivePreview();
}

function setLoading(isLoading) {
  const button = $('#generateButton');
  if (!button) return;
  button.disabled = isLoading;
  button.innerHTML = isLoading ? '<span class="spinner"></span> AI 讀取媒體中…' : '<span>✦</span> AI 產生文案';
}

async function loadData() {
  const config = await api('/api/config');

  state.config = config;
  state.clients = config.clients || [];
  if (!state.currentClientId || !state.clients.some((client) => client.id === state.currentClientId)) {
    setCurrentClientId(state.clients[0]?.id || '');
  }
  renderClientSwitcher();

  const [posts, schedule, templates, campaigns, insights, inbox] = await Promise.all([
    api(clientQuery('/api/posts')),
    api(clientQuery('/api/schedule')),
    api(clientQuery('/api/templates')),
    api(clientQuery('/api/campaigns')),
    api(clientQuery('/api/insights')).catch(() => ({ status: 'unavailable', sources: [] })),
    api(clientQuery('/api/inbox')).catch(() => ({ status: 'unavailable', sources: [] })),
  ]);

  const facebookStatus = await api('/api/facebook/status').catch((error) => ({
    configured: config.facebookConfigured,
    connected: false,
    error: error.message,
  }));

  state.posts = posts;
  state.schedule = schedule;
  state.templates = templates;
  state.campaigns = campaigns;
  state.insights = insights;
  state.inbox = inbox;
  state.config = { ...config, facebookConnected: facebookStatus.connected, facebookPage: facebookStatus.page };
  state.platforms = config.publishingPlatforms || [];
  applyClientAccounts();
  loadClientFacebookFields();

  if (config.version && $('#appVersion')) {
    $('#appVersion').textContent = config.version.startsWith('v') ? config.version : 'v' + config.version;
  }

  renderPreviewPlatformTabs();
  renderPlatformOptions(config.publishingPlatforms);
  renderContentTypeOptions('facebook');
  renderCreatePublishSpec();
  renderPosts();
  renderSchedule();
  renderOverview();
  renderMediaLibrary();
  renderPublishingLogs();
  renderPlatformConnections();
  renderTemplates();
  renderCampaigns();
  renderInsights();
  renderInbox();

  const status = $('#apiStatus');
  if (status) {
    const client = currentClient();
    const clientLabel = client ? client.name : '未選品牌';
    const aiOk = Boolean(config.aiConfigured);
    const facebookAccount = (client?.accounts || []).find((account) => account.platformId === 'facebook' && account.configured);
    const fbOk = Boolean(facebookAccount) || Boolean(facebookStatus.connected);
    const compact = window.matchMedia('(max-width: 768px)').matches;
    status.textContent = compact
      ? ((aiOk ? 'AI✓' : 'AI✗') + ' · ' + (fbOk ? 'FB✓' : 'FB✗'))
      : (clientLabel + ' · ' + (aiOk ? config.provider + ' 已連線' : 'Gemini 未連線') + ' · ' + (facebookAccount ? 'FB 已設定' : (facebookStatus.connected ? 'FB 全域已連線' : 'FB 未設定')));
    status.title = [
      clientLabel,
      aiOk ? (config.provider + ' 已連線') : 'Gemini 未連線',
      facebookAccount ? 'FB 已設定' : (facebookStatus.connected ? 'FB 全域已連線' : 'FB 未設定'),
      facebookStatus.error || '',
    ].filter(Boolean).join('\n');
    status.dataset.ready = config.aiConfigured ? 'true' : 'false';
  }

  if (config.aiConfigured) {
    setFormMessage('先選品牌，再建立內容；每個平台都能各自覆寫與排程。');
  } else {
    setFormMessage('未連線 Gemini；可到「⚙️ 設定」填入 API Key。', 'error');
  }
}

function initApp() {
  initTabs();
  initContentFilters();
  initCalendarControls();
  initMediaLibrary();
  initTemplateManager(loadData);

  const imageInput = $('#imageInput');
  if (imageInput) {
    imageInput.addEventListener('change', (event) => {
      previewSelectedMedia(event.target.files, renderSavedMedia);
    });
  }

  const uploadZone = $('#uploadZone');
  if (uploadZone) {
    let dragDepth = 0;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      uploadZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });

    uploadZone.addEventListener('dragenter', (event) => {
      if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
      dragDepth += 1;
      uploadZone.classList.add('drag-active');
    });

    uploadZone.addEventListener('dragover', (event) => {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });

    uploadZone.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) uploadZone.classList.remove('drag-active');
    });

    uploadZone.addEventListener('drop', (event) => {
      dragDepth = 0;
      uploadZone.classList.remove('drag-active');
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) {
        setFormMessage('沒有讀取到檔案，請從檔案總管拖入圖片或影片。', 'error');
        return;
      }
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      const input = $('#imageInput');
      if (input) {
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  bindUploadReordering(renderSavedMedia);
  renderPreviewPlatformTabs();
  updateLivePreview();

  const createType = $('#createContentType');
  if (createType) {
    createType.addEventListener('change', (event) => {
      renderCreateContentSettings('facebook', event.target.value);
      // A：產文格式一改，預覽鎖定同步
      applyActiveTargetToEditor();
      renderPreviewPlatformTabs();
      updateLivePreview();
    });
  }

  const generateForm = $('#generateForm');
  if (generateForm) {
    generateForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const files = $('#imageInput').files;
      const formData = new FormData(event.currentTarget);
      setLoading(true);
      setFormMessage(files.length
        ? '正在讀取 ' + files.length + ' 個媒體並撰寫文案，影片可能需要較長時間。'
        : '正在根據文字資訊撰寫文案。');
      try {
        const generated = await api('/api/generate', { method: 'POST', body: formData });
        state.savedPost = null;
        renderGenerated(generated, { syncSelectedMedia: true });
        setActiveView('review');
        setFormMessage('文案已產生，請在右側檢查後儲存。', 'success');
      } catch (error) {
        setFormMessage(error.message, 'error');
        showToast(error.message, 'error');
      } finally {
        setLoading(false);
      }
    });
  }

  initEditorListeners(refreshLists);
  initScheduleDialog(refreshLists);
  initPublishingLogs(refreshLists);
  initCampaignManager(loadData);
  initTargetListeners({
    onActiveTargetChange: () => {
      renderPreviewPlatformTabs();
      updateLivePreview();
    },
  });
  initClientListeners({
    onClientChanged: async () => {
      applyClientAccounts();
      await refreshLists();
      loadClientFacebookFields();
    },
    onClientsUpdated: async () => {
      state.clients = await api('/api/clients');
      renderClientSwitcher();
      applyClientAccounts();
      await refreshLists();
    },
  });
  initSettingsListeners(async () => {
    await loadData();
    await loadSettings();
  });
  initSystemTools(loadData);

  const refreshBtn = $('#refreshButton');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await refreshLists();
      showToast('資料已重新整理', 'success');
    });
  }

  loadData().catch((error) => showToast(error.message, 'error'));
  loadSettings().catch((error) => showToast(error.message, 'error'));
}

document.addEventListener('DOMContentLoaded', initApp);
