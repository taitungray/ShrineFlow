import { $, escapeHtml, setFormMessage, showToast } from './modules/dom.js';
import { state } from './modules/state.js';
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
import { renderPosts } from './modules/drafts.js';
import { renderSchedule, initScheduleDialog } from './modules/schedule.js';
import { loadSettings, initSettingsListeners } from './modules/settings.js';

async function refreshLists() {
  state.posts = await api('/api/posts');
  state.schedule = await api('/api/schedule');
  renderPosts();
  renderSchedule();
}

function setLoading(isLoading) {
  const button = $('#generateButton');
  if (!button) return;
  button.disabled = isLoading;
  button.innerHTML = isLoading ? '<span class="spinner"></span> AI 讀取媒體中…' : '<span>✦</span> AI 產生文案';
}

async function loadData() {
  const [gods, posts, schedule, config] = await Promise.all([
    api('/api/gods'),
    api('/api/posts'),
    api('/api/schedule'),
    api('/api/config'),
  ]);
  const facebookStatus = await api('/api/facebook/status').catch((error) => ({
    configured: config.facebookConfigured,
    connected: false,
    error: error.message,
  }));

  const godSuggestions = $('#godSuggestions');
  if (godSuggestions) {
    godSuggestions.innerHTML = gods.map((god) => '<option value="' + escapeHtml(god.name) + '"></option>').join('');
  }

  state.posts = posts;
  state.schedule = schedule;
  state.config = { ...config, facebookConnected: facebookStatus.connected, facebookPage: facebookStatus.page };
  state.platforms = config.publishingPlatforms || [];
  state.accounts = config.publishingAccounts || [];

  if (config.version && $('#appVersion')) {
    $('#appVersion').textContent = config.version.startsWith('v') ? config.version : 'v' + config.version;
  }

  renderPreviewPlatformTabs();
  renderPlatformOptions(config.publishingPlatforms);
  renderAccountOptions('facebook');
  renderContentTypeOptions('facebook');
  renderCreatePublishSpec();
  renderPosts();
  renderSchedule();

  const status = $('#apiStatus');
  if (status) {
    const aiStatus = config.aiConfigured ? config.provider + ' 已連線' : 'Gemini 未連線';
    const facebookLabel = facebookStatus.connected
      ? 'Facebook 已連線' + (facebookStatus.page?.name ? '：' + facebookStatus.page.name : '')
      : config.facebookConfigured ? 'Facebook 驗證失敗' : 'Facebook 未設定';
    status.textContent = aiStatus + ' · ' + facebookLabel;
    status.title = facebookStatus.error || '';
    status.dataset.ready = config.aiConfigured && facebookStatus.connected ? 'true' : 'false';
  }

  if (config.aiConfigured) {
    setFormMessage(facebookStatus.connected
      ? '上傳圖片或影片送到 Gemini 產生文案，完成後可自動排程發布。'
      : config.facebookConfigured
        ? 'Gemini 已可使用；Facebook 憑證驗證失敗，請查看右上角提示。'
        : 'Gemini 已可使用；若要自動發布，請在系統設定提供 Facebook 憑證。');
  } else {
    setFormMessage('未連線 Gemini；可點擊上方「⚙️ 系統設定」填入 API Key。', 'error');
  }
}

function initApp() {
  initTabs();

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

  const createChannel = $('#createChannel');
  if (createChannel) {
    createChannel.addEventListener('change', () => renderCreatePublishSpec());
  }
  const createType = $('#createContentType');
  if (createType) {
    createType.addEventListener('change', (event) => renderCreateContentSettings($('#createChannel').value, event.target.value));
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
  initSettingsListeners(async () => {
    await loadData();
    await loadSettings();
  });

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
