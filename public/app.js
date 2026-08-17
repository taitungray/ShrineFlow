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
import { buildGenerateMediaPayload } from './modules/media-picker.js';
import { initMediaPicker } from './modules/media-picker-ui.js';
import {
  renderPreviewPlatformTabs,
  updateLivePreview,
  renderSavedMedia,
  renderGenerated,
  initEditorListeners,
  startNewComposer,
} from './modules/editor.js';
import { renderPosts, initContentFilters } from './modules/drafts.js';
import { initBulkImportListeners } from './modules/bulk-import.js';
import { renderSchedule, initScheduleDialog, initCalendarControls } from './modules/schedule.js';
import { renderOverview } from './modules/overview.js';
import { renderMediaLibrary, initMediaLibrary } from './modules/media-library.js';
import { renderPublishingLogs, initPublishingLogs } from './modules/publishing-logs.js';
import { renderPlatformConnections } from './modules/platform-connections.js';
import { renderApiStatus } from './modules/api-status.js';
import { renderTemplates, initTemplateManager } from './modules/templates.js';
import { renderCampaigns, initCampaignManager } from './modules/campaigns.js';
import { renderInsights, initInsightsListeners } from './modules/insights.js';
import { renderInbox, initInboxListeners } from './modules/inbox.js';
import { loadSettings, initSettingsListeners } from './modules/settings.js';
import { initSystemTools } from './modules/system.js';
import { initErrorLogs } from './modules/error-log-page.js';
import { initializeAuth, initAuthListeners, renderUserIdentity } from './modules/auth.js';
import { initClientErrorReporter } from './modules/client-error-reporter.js';
import { renderClientSwitcher, initClientListeners, loadClientFacebookFields } from './modules/clients-ui.js';
import { renderTargetAccountControls, applyActiveTargetToEditor, initTargetListeners } from './modules/targets-ui.js';
import { applyPermissionUi, initTeamListeners, loadTeamManagement } from './modules/team.js';
import { initKeyboardShortcuts } from './modules/shortcuts.js';
import { initReviewListeners, loadReviewQueue, renderReviewQueue } from './modules/reviews.js';
import { initQueueSettings, loadQueueSettings, renderQueueSettings } from './modules/queue.js';
import { initCrisisPause, loadCrisisPause, renderCrisisPause } from './modules/crisis-pause.js';
import { initHelp } from './modules/help.js';
import { initDateTime24h } from './modules/datetime-24h.js';
import { renderBestTimes } from './modules/best-times.js';
import { renderRemoteSchedule } from './modules/remote-schedule.js';

async function refreshLists() {
  const insightsPath = clientQuery('/api/insights?scope=' + encodeURIComponent(state.insightsScope || 'account'));
  const [posts, schedule, templates, campaigns, insights, inbox, notifications, savedReplies, crisisPause, bestTimes, remoteSchedule, repurposeCandidates] = await Promise.all([
    api(clientQuery('/api/posts')).then((value) => (Array.isArray(value) ? value : [])),
    api(clientQuery('/api/schedule')).then((value) => (Array.isArray(value) ? value : [])),
    api(clientQuery('/api/templates')).then((value) => (Array.isArray(value) ? value : [])),
    api(clientQuery('/api/campaigns')).then((value) => (Array.isArray(value) ? value : [])),
    api(insightsPath).catch(() => ({ status: 'unavailable', sources: [] })),
    api(clientQuery('/api/inbox')).catch(() => ({ status: 'unavailable', sources: [] })),
    api(clientQuery('/api/system/notifications?unreadOnly=true&limit=50')).catch(() => []),
    api(clientQuery('/api/saved-replies')).catch(() => []),
    api(clientQuery('/api/crisis-pause')).catch(() => null),
    api(clientQuery('/api/insights/best-times')).catch(() => ({ status: 'unavailable', slots: [] })),
    api(clientQuery('/api/remote-schedule')).catch(() => ({ status: 'remote_schedule_unavailable', sources: [] })),
    api(clientQuery('/api/insights/repurpose')).catch(() => ({ status: 'insufficient_data', candidates: [] })),
  ]);
  state.posts = posts;
  state.schedule = schedule;
  state.templates = templates;
  state.campaigns = campaigns;
  state.insights = insights;
  state.insightsScope = insights.scope || state.insightsScope || 'account';
  state.inbox = inbox;
  state.notifications = Array.isArray(notifications) ? notifications : [];
  state.savedReplies = Array.isArray(savedReplies) ? savedReplies : [];
  state.crisisPause = crisisPause;
  state.bestTimes = bestTimes;
  state.remoteSchedule = remoteSchedule;
  state.repurposeCandidates = repurposeCandidates;
  await loadReviewQueue().catch(() => { state.reviewQueue = []; renderReviewQueue(); });
  renderPosts();
  renderSchedule();
  renderOverview();
  renderMediaLibrary();
  renderPublishingLogs();
  renderPlatformConnections();
  renderQueueSettings();
  renderCrisisPause();
  renderTemplates();
  renderCampaigns();
  renderInsights();
  renderInbox();
  renderBestTimes();
  renderRemoteSchedule();
}

function applyClientAccounts() {
  const client = currentClient();
  state.accounts = (client?.accounts || []).map((account) => ({
    id: account.id,
    platformId: account.platformId,
    name: account.name,
    configured: Boolean(account.configured),
    enabled: account.enabled !== false,
    capabilities: account.capabilities || {},
    queue: account.queue || null,
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function resolveClientsFromConfig(config) {
  let clients = asArray(config?.clients);
  if (clients.length) return clients;
  try {
    clients = asArray(await api('/api/clients'));
  } catch (error) {
    console.warn('fallback /api/clients failed:', error);
  }
  return clients;
}

async function loadData() {
  const config = await api('/api/config');
  let posts = [];
  let schedule = [];
  let templates = [];
  let campaigns = [];
  let insights = { status: 'unavailable', sources: [] };
  let inbox = { status: 'unavailable', sources: [] };
  let notifications = [];
  let savedReplies = [];
  let crisisPause = null;
  let bestTimes = { status: 'unavailable', slots: [] };
  let remoteSchedule = { status: 'remote_schedule_unavailable', sources: [] };
  let repurposeCandidates = { status: 'insufficient_data', candidates: [] };
  let facebookStatus = {
    configured: Boolean(config.facebookConfigured),
    connected: false,
    error: '',
  };

  try {
    state.config = config;
    state.clients = await resolveClientsFromConfig(config);
    if (!state.currentClientId || !state.clients.some((client) => client.id === state.currentClientId)) {
      setCurrentClientId(state.clients[0]?.id || '');
    }
    renderClientSwitcher();
    renderUserIdentity();
    applyPermissionUi();

    const insightsPath = clientQuery('/api/insights?scope=' + encodeURIComponent(state.insightsScope || 'account'));
    [
      posts,
      schedule,
      templates,
      campaigns,
      insights,
      inbox,
      notifications,
      savedReplies,
      crisisPause,
      bestTimes,
      remoteSchedule,
      repurposeCandidates,
    ] = await Promise.all([
      api(clientQuery('/api/posts')).then(asArray),
      api(clientQuery('/api/schedule')).then(asArray),
      api(clientQuery('/api/templates')).then(asArray),
      api(clientQuery('/api/campaigns')).then(asArray),
      api(insightsPath).catch(() => ({ status: 'unavailable', sources: [] })),
      api(clientQuery('/api/inbox')).catch(() => ({ status: 'unavailable', sources: [] })),
      api(clientQuery('/api/system/notifications?unreadOnly=true&limit=50')).catch(() => []),
      api(clientQuery('/api/saved-replies')).catch(() => []),
      api(clientQuery('/api/crisis-pause')).catch(() => null),
      api(clientQuery('/api/insights/best-times')).catch(() => ({ status: 'unavailable', slots: [] })),
      api(clientQuery('/api/remote-schedule')).catch(() => ({ status: 'remote_schedule_unavailable', sources: [] })),
      api(clientQuery('/api/insights/repurpose')).catch(() => ({ status: 'insufficient_data', candidates: [] })),
    ]);

    facebookStatus = await api(clientQuery('/api/facebook/status')).catch((error) => ({
      configured: config.facebookConfigured,
      connected: false,
      error: error.message,
    }));

    if (!state.clients.length && posts.length) {
      const clientIds = [...new Set(posts.map((post) => post.clientId).filter(Boolean))];
      if (clientIds.length) {
        showToast('品牌列表異常，已用貼文品牌暫時還原。請重新整理。', 'error');
        state.clients = clientIds.map((id) => ({ id, name: id, accounts: [] }));
        if (!state.currentClientId) setCurrentClientId(clientIds[0]);
        renderClientSwitcher();
      }
    }
  } catch (error) {
    showToast(error.message || '載入資料失敗', 'error');
  } finally {
    state.posts = asArray(posts);
    state.schedule = asArray(schedule);
    state.templates = asArray(templates);
    state.campaigns = asArray(campaigns);
    state.insights = insights;
    state.insightsScope = insights.scope || state.insightsScope || 'account';
    state.inbox = inbox;
    state.notifications = asArray(notifications);
    state.savedReplies = asArray(savedReplies);
    state.crisisPause = crisisPause;
    state.bestTimes = bestTimes;
    state.remoteSchedule = remoteSchedule;
    state.repurposeCandidates = repurposeCandidates;
    state.facebookStatus = facebookStatus;
    state.config = { ...config, facebookConnected: facebookStatus.connected, facebookPage: facebookStatus.page };
    state.platforms = asArray(config.publishingPlatforms);
    applyClientAccounts();
    try { await loadQueueSettings(); } catch { /* keep UI usable */ }
    try { await loadCrisisPause(); } catch { /* keep UI usable */ }
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
    renderQueueSettings();
    renderCrisisPause();
    renderTemplates();
    renderCampaigns();
    renderInsights();
    renderInbox();
    renderBestTimes();
    renderRemoteSchedule();
    try { await loadTeamManagement(); } catch { /* keep UI usable */ }
    await loadReviewQueue().catch(() => { state.reviewQueue = []; renderReviewQueue(); });

    renderApiStatus();

    if (config.aiConfigured) {
      setFormMessage('先選品牌，再建立內容；每個平台都能各自覆寫與排程。');
    } else {
      setFormMessage('未連線 Gemini；可到「⚙️ 設定」填入 API Key。', 'error');
    }
  }
}

async function initApp() {
  if (!(await initializeAuth())) return;
  initClientErrorReporter();
  initAuthListeners();
  initTabs({ onStartCreate: startNewComposer });
  initDateTime24h();
  initHelp();
  initInsightsListeners();
  initInboxListeners();
  initContentFilters(refreshLists);
  initBulkImportListeners();
  initReviewListeners(refreshLists);
  initCalendarControls(refreshLists);
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
    const isExternalFileDrag = (event) => (
      [...(event.dataTransfer?.types || [])].includes('Files') && state.mediaDragIndex === null
    );

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      uploadZone.addEventListener(eventName, (event) => {
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
      });
    });

    uploadZone.addEventListener('dragenter', (event) => {
      if (!isExternalFileDrag(event)) return;
      dragDepth += 1;
      uploadZone.classList.add('drag-active');
    });

    uploadZone.addEventListener('dragover', (event) => {
      if (!isExternalFileDrag(event) || !event.dataTransfer) return;
      event.dataTransfer.dropEffect = 'copy';
    });

    uploadZone.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) uploadZone.classList.remove('drag-active');
    });

    uploadZone.addEventListener('drop', (event) => {
      dragDepth = 0;
      uploadZone.classList.remove('drag-active');
      if (!isExternalFileDrag(event)) return;
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
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
  initMediaPicker(renderSavedMedia);
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
      const formData = new FormData(event.currentTarget);
      const mediaPayload = buildGenerateMediaPayload(state.selectedMediaItems);
      formData.delete('media');
      mediaPayload.files.forEach((file) => formData.append('media', file));
      if (mediaPayload.sequence.length) formData.set('mediaSequence', JSON.stringify(mediaPayload.sequence));
      if (state.currentClientId) formData.set('clientId', state.currentClientId);
      setLoading(true);
      const hasLibrary = mediaPayload.sequence.some((entry) => entry.kind === 'library');
      setFormMessage(mediaPayload.files.length
        ? '正在讀取 ' + mediaPayload.files.length + ' 個媒體並撰寫文案，影片可能需要較長時間。'
        : (hasLibrary ? '正在沿用素材庫檔案並撰寫文案。' : '正在根據文字資訊撰寫文案。'));
      try {
        const generated = await api('/api/generate', { method: 'POST', body: formData });
        state.savedPost = null;
        renderGenerated(generated, { syncSelectedMedia: true });
        setActiveView('review');
        setFormMessage('文案已產生，請檢查預覽後儲存。', 'success');
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
  initQueueSettings();
  initCrisisPause(refreshLists);
  initPublishingLogs(refreshLists);
  initCampaignManager(loadData);
  initTeamListeners();
  initTargetListeners({
    onActiveTargetChange: () => {
      renderPreviewPlatformTabs();
      updateLivePreview();
    },
  });
  initClientListeners({
    onClientChanged: async () => {
      applyClientAccounts();
      await loadQueueSettings();
      await loadCrisisPause();
      renderUserIdentity();
      applyPermissionUi();
      await refreshLists();
      await loadTeamManagement();
      loadClientFacebookFields();
      renderApiStatus();
      renderPlatformConnections();
    },
    onClientsUpdated: async () => {
      state.clients = await api('/api/clients');
      renderClientSwitcher();
      applyClientAccounts();
      await loadQueueSettings();
      await loadCrisisPause();
      renderUserIdentity();
      applyPermissionUi();
      await refreshLists();
      await loadTeamManagement();
      loadClientFacebookFields();
      renderApiStatus();
      renderPlatformConnections();
    },
  });
  initSettingsListeners(async () => {
    await loadData();
    await loadSettings();
  });
  initSystemTools(loadData);
  initErrorLogs();

  const refreshBtn = $('#refreshButton');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await refreshLists();
      showToast('資料已重新整理', 'success');
    });
  }

  // Network connectivity status sensing
  window.addEventListener('offline', () => {
    showToast('⚠️ 網路連線已中斷，編輯內容已安全快照至瀏覽器本機。', 'error');
  });
  window.addEventListener('online', () => {
    showToast('🟢 網路連線已恢復。', 'success');
  });

  // Power-user keyboard shortcuts
  initKeyboardShortcuts();

  loadData().catch((error) => showToast(error.message, 'error'));
  loadSettings().catch((error) => showToast(error.message, 'error'));
}

document.addEventListener('DOMContentLoaded', initApp);
