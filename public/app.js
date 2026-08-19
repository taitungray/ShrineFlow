import { $, setFormMessage, setPreviewMessage, showToast, fieldValue } from './modules/dom.js';
import { state, clientQuery, setCurrentClientId, currentClient } from './modules/state.js';
import { api } from './modules/api.js';
import {
  startAndWaitGenerate,
  waitForBackgroundJob,
  waitForPublishTarget,
  readPendingLongTask,
  clearPendingLongTask,
} from './modules/long-task.js';
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
import { renderMediaLibrary, initMediaLibrary, loadMediaLibraryAssets } from './modules/media-library.js';
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
import { initResumeStability, endBooting } from './modules/boot-stability.js';
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
import { initBusinessSuiteButtons } from './modules/business-suite.js';

let listsGeneration = 0;

function beginListsGeneration() {
  listsGeneration += 1;
  return listsGeneration;
}

function isCurrentListsGeneration(generation) {
  return generation === listsGeneration;
}

async function fetchCoreLists() {
  const [posts, schedule, templates, campaigns, notifications, savedReplies, crisisPause] = await Promise.all([
    api(clientQuery('/api/posts')).then(asArray),
    api(clientQuery('/api/schedule')).then(asArray),
    api(clientQuery('/api/templates')).then(asArray),
    api(clientQuery('/api/campaigns')).then(asArray),
    api(clientQuery('/api/system/notifications?unreadOnly=true&limit=50')).catch(() => []),
    api(clientQuery('/api/saved-replies')).catch(() => []),
    api(clientQuery('/api/crisis-pause')).catch(() => null),
  ]);
  state.posts = posts;
  state.schedule = schedule;
  state.templates = templates;
  state.campaigns = campaigns;
  state.notifications = asArray(notifications);
  state.savedReplies = asArray(savedReplies);
  state.crisisPause = crisisPause;
}

async function fetchSecondaryLists() {
  const insightsPlatform = state.insightsPlatform || 'facebook';
  const insightsPath = clientQuery('/api/insights?scope=' + encodeURIComponent(state.insightsScope || 'account'));
  const [insights, inbox, bestTimes, remoteSchedule, repurposeCandidates] = await Promise.all([
    api(insightsPath).catch(() => ({ status: 'unavailable', sources: [] })),
    api(clientQuery('/api/inbox')).catch(() => ({ status: 'unavailable', sources: [] })),
    api(clientQuery('/api/insights/best-times?platform=' + encodeURIComponent(insightsPlatform))).catch(() => ({ status: 'unavailable', slots: [] })),
    api(clientQuery('/api/remote-schedule')).catch(() => ({ status: 'remote_schedule_unavailable', sources: [] })),
    api(clientQuery('/api/insights/repurpose?platform=' + encodeURIComponent(insightsPlatform))).catch(() => ({ status: 'insufficient_data', candidates: [] })),
  ]);
  state.insights = insights;
  state.insightsScope = insights.scope || state.insightsScope || 'account';
  state.inbox = inbox;
  state.bestTimes = bestTimes;
  state.remoteSchedule = remoteSchedule;
  state.repurposeCandidates = repurposeCandidates;
}

function renderCoreLists() {
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
}

function renderSecondaryLists() {
  renderInsights();
  renderInbox();
  renderBestTimes();
  renderRemoteSchedule();
  renderOverview();
}

async function hydrateBackgroundLists(generation) {
  await Promise.all([
    fetchSecondaryLists().then(() => {
      if (!isCurrentListsGeneration(generation)) return;
      renderSecondaryLists();
    }),
    loadReviewQueue().catch(() => {
      if (!isCurrentListsGeneration(generation)) return;
      state.reviewQueue = [];
      renderReviewQueue();
    }),
    loadMediaLibraryAssets().then(() => {
      if (!isCurrentListsGeneration(generation)) return;
      renderMediaLibrary();
    }).catch(() => {}),
  ]);
}

async function refreshLists() {
  const generation = beginListsGeneration();
  await fetchCoreLists();
  if (!isCurrentListsGeneration(generation)) return;
  renderCoreLists();
  void hydrateBackgroundLists(generation);
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

let activeLongTaskAbort = null;

function setLoading(isLoading) {
  const button = $('#generateButton');
  const cancel = $('#cancelGenerateButton');
  if (button) {
    button.disabled = isLoading;
    button.innerHTML = isLoading ? '<span class="spinner"></span> AI 產文中…' : '<span>✦</span> AI 產生文案';
  }
  if (cancel) {
    cancel.hidden = !isLoading;
    cancel.disabled = !isLoading;
  }
}

function beginLongTaskWait() {
  activeLongTaskAbort?.abort();
  activeLongTaskAbort = new AbortController();
  return activeLongTaskAbort;
}

function endLongTaskWait(controller) {
  if (activeLongTaskAbort === controller) activeLongTaskAbort = null;
}

function reportGenerateError(error) {
  if (error?.code === 'LONG_TASK_ABORTED' || error?.name === 'AbortError') {
    setFormMessage(error.message || '已取消等待，可再按一次產生。');
    return;
  }
  setFormMessage(error.message, 'error');
  showToast(error.message, 'error');
}

async function loadPostById(postId) {
  const posts = await api(clientQuery('/api/posts'));
  return (Array.isArray(posts) ? posts : []).find((item) => item.id === postId) || null;
}

async function resumePendingLongTask() {
  const pending = readPendingLongTask();
  if (!pending) return;
  if (pending.type === 'rewrite') {
    clearPendingLongTask();
    return;
  }
  if (pending.type === 'generate' && pending.jobId) {
    const controller = beginLongTaskWait();
    setLoading(true);
    setFormMessage('正在恢復先前的文案產生…可按「取消等待」中止。');
    try {
      const generated = await waitForBackgroundJob(pending.jobId, { api, signal: controller.signal });
      state.savedPost = null;
      renderGenerated(generated, { syncSelectedMedia: true });
      setActiveView('review');
      setFormMessage('文案已產生，請檢查預覽後儲存。', 'success');
    } catch (error) {
      clearPendingLongTask();
      reportGenerateError(error);
    } finally {
      endLongTaskWait(controller);
      setLoading(false);
    }
    return;
  }
  if (pending.type === 'publish' && pending.postId && pending.targetId) {
    setPreviewMessage('正在恢復發布結果…', 'info');
    try {
      await waitForPublishTarget({
        postId: pending.postId,
        targetId: pending.targetId,
        loadPost: () => loadPostById(pending.postId),
      });
      await refreshLists();
      const refreshedPost = state.posts.find((item) => item.id === pending.postId);
      if (refreshedPost) {
        state.savedPost = refreshedPost;
        state.generated = refreshedPost;
        state.editorDirty = false;
        renderGenerated(refreshedPost);
      }
      setPreviewMessage('發布已完成。', 'success');
      showToast('發布已完成。', 'success');
    } catch (error) {
      clearPendingLongTask();
      setPreviewMessage(error.message, 'error');
      showToast(error.message, 'error');
    }
  }
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
  if (config?.version && $('#appVersion')) {
    $('#appVersion').textContent = config.version.startsWith('v') ? config.version : 'v' + config.version;
  }
  const generation = beginListsGeneration();
  state.config = config;
  state.platforms = asArray(config.publishingPlatforms);
  state.facebookStatus = {
    configured: Boolean(config.facebookConfigured),
    connected: false,
    error: '',
  };

  try {
    state.clients = await resolveClientsFromConfig(config);
    if (!state.currentClientId || !state.clients.some((client) => client.id === state.currentClientId)) {
      setCurrentClientId(state.clients[0]?.id || '');
    }
    renderClientSwitcher();
    renderUserIdentity();
    applyPermissionUi();
    await fetchCoreLists();
    if (!isCurrentListsGeneration(generation)) return;
    if (!state.clients.length && state.posts.length) {
      const clientIds = [...new Set(state.posts.map((post) => post.clientId).filter(Boolean))];
      if (clientIds.length) {
        showToast('品牌列表異常，已用貼文品牌暫時還原。請重新整理。', 'error');
        state.clients = clientIds.map((id) => ({ id, name: id, accounts: [] }));
        if (!state.currentClientId) setCurrentClientId(clientIds[0]);
        renderClientSwitcher();
      }
    }
  } catch (error) {
    showToast(error.message || '載入資料失敗', 'error');
  }

  if (!isCurrentListsGeneration(generation)) return;
  applyClientAccounts();
  renderPreviewPlatformTabs();
  renderPlatformOptions(config.publishingPlatforms);
  renderContentTypeOptions('facebook');
  renderCreatePublishSpec();
  renderCoreLists();
  renderApiStatus();
  setFormMessage(
    config.aiConfigured
      ? '先選品牌，再建立內容；每個平台都能各自覆寫與排程。'
      : '未連線 Gemini；可到「⚙️ 設定」填入 API Key。',
    config.aiConfigured ? undefined : 'error',
  );
  void hydrateBackgroundLists(generation);
  void api(clientQuery('/api/facebook/status')).then((facebookStatus) => {
    if (!isCurrentListsGeneration(generation)) return;
    state.facebookStatus = facebookStatus;
    state.config = { ...state.config, facebookConnected: facebookStatus.connected, facebookPage: facebookStatus.page };
    renderApiStatus();
    renderPlatformConnections();
    renderOverview();
  }).catch((error) => {
    if (!isCurrentListsGeneration(generation)) return;
    state.facebookStatus = {
      configured: Boolean(config.facebookConfigured),
      connected: false,
      error: error.message,
    };
    renderApiStatus();
  });
  void loadQueueSettings().then(() => {
    if (isCurrentListsGeneration(generation)) renderQueueSettings();
  }).catch(() => {});
  void loadCrisisPause().then(() => {
    if (isCurrentListsGeneration(generation)) renderCrisisPause();
  }).catch(() => {});
  void loadTeamManagement().catch(() => {});
  loadClientFacebookFields();
}

async function initApp() {
  if (!(await initializeAuth())) return;
  initClientErrorReporter();
  initAuthListeners();
  initTabs({ onStartCreate: startNewComposer });
  initDateTime24h();
  initBusinessSuiteButtons();
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

  const cancelGenerateButton = $('#cancelGenerateButton');
  if (cancelGenerateButton) {
    cancelGenerateButton.addEventListener('click', () => {
      activeLongTaskAbort?.abort();
      clearPendingLongTask();
      setLoading(false);
      setFormMessage('已取消等待，可再按一次產生。');
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
      const controller = beginLongTaskWait();
      setLoading(true);
      const hasLibrary = mediaPayload.sequence.some((entry) => entry.kind === 'library');
      setFormMessage(mediaPayload.files.length
        ? '正在讀取 ' + mediaPayload.files.length + ' 個媒體並撰寫文案。可按「取消等待」中止畫面等待。'
        : (hasLibrary ? '正在沿用素材庫檔案並撰寫文案。可按「取消等待」中止畫面等待。' : '正在根據文字資訊撰寫文案。可按「取消等待」中止畫面等待。'));
      try {
        const generated = await startAndWaitGenerate(formData, { api, signal: controller.signal });
        state.savedPost = null;
        renderGenerated(generated, { syncSelectedMedia: true });
        setActiveView('review');
        const reused = Number(generated.reusedMediaCount) || 0;
        setFormMessage(
          reused
            ? '文案已產生。有 ' + reused + ' 個檔與素材庫重複，已改用既有素材。'
            : '文案已產生，請檢查預覽後儲存。',
          'success',
        );
      } catch (error) {
        clearPendingLongTask();
        reportGenerateError(error);
      } finally {
        endLongTaskWait(controller);
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

  loadData()
    .then(() => resumePendingLongTask())
    .catch((error) => showToast(error.message, 'error'));
  loadSettings().catch((error) => showToast(error.message, 'error'));
}

function lockPhonePortrait() {
  const orientation = globalThis.screen?.orientation;
  if (!orientation || typeof orientation.lock !== 'function') return;
  orientation.lock('portrait').catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  lockPhonePortrait();
  initResumeStability();
  initApp().finally(() => endBooting());
});
