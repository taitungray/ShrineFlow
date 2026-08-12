const state = {
  generated: null,
  savedPost: null,
  posts: [],
  schedule: [],
  config: null,
  uploadPreviewUrls: [],
  selectedMediaItems: [],
  mediaDragIndex: null,
  selectedPlatform: 'facebook',
  platforms: [],
  accounts: [],
};

const DEFAULT_HASHTAGS = ['#神像彩繪', '#宮廟藝術', '#傳統工藝', '#台灣信仰'];
const PLATFORM_NAMES = { facebook: 'Facebook 粉專', instagram: 'Instagram', threads: 'Threads', line: 'LINE VOOM' };
const PLATFORM_DESCRIPTIONS = {
  facebook: '標準粉專貼文，支援多張圖片與單支影片。',
  instagram: '以圖片／影片為主，搭配 caption 與 Hashtag。',
  threads: '文字優先的貼文，可附加圖片。',
  line: '適合訊息較短、搭配直式素材的動態貼文。',
};

const $ = (selector) => document.querySelector(selector);
const api = (path, options) => fetch(path, options).then(async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '請求失敗');
  return data;
});

function setActiveView(view) {
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.classList.toggle('is-hidden', panel.dataset.viewPanel !== view);
  });
  document.querySelectorAll('[data-view-target]').forEach((tab) => {
    const isActive = tab.dataset.viewTarget === view;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
}

function updateLivePreview() {
  const text = $('#facebookText')?.value?.trim() || '';
  const preview = $('#facebookPreview');
  if (preview) {
    preview.innerHTML = text
      ? text.split(/\n{2,}/).map((paragraph) => '<p>' + escapeHtml(paragraph).replace(/\n/g, '<br>') + '</p>').join('')
      : '尚未產生文案。';
  }
  const hashtagsPreview = $('#hashtagsPreview');
  if (hashtagsPreview) hashtagsPreview.textContent = $('#hashtagsText')?.value?.trim() || '';
  const previewCard = document.querySelector('.copy-preview-card');
  if (previewCard) {
    previewCard.dataset.platform = state.selectedPlatform;
    const title = previewCard.querySelector('h4');
    if (title) title.textContent = `${PLATFORM_NAMES[state.selectedPlatform] || '平台'} 貼文預覽`;
  }
  const mediaWrap = $('#previewImageWrap');
  if (mediaWrap) mediaWrap.dataset.platform = state.selectedPlatform;
}

function renderPreviewPlatformTabs() {
  const container = $('#previewPlatformTabs');
  if (!container) return;
  const platforms = state.platforms.length ? state.platforms : Object.keys(PLATFORM_NAMES).map((id) => ({ id, name: PLATFORM_NAMES[id], shortName: PLATFORM_NAMES[id], canPublish: id === 'facebook' }));
  if (!platforms.some((platform) => platform.id === state.selectedPlatform)) state.selectedPlatform = platforms[0]?.id || 'facebook';
  container.innerHTML = platforms.map((platform) => {
    const active = platform.id === state.selectedPlatform;
    const status = platform.canPublish ? '' : '（預覽）';
    return '<button class="platform-tab' + (active ? ' active' : '') + '" type="button" role="tab" aria-selected="' + active + '" data-preview-platform="' + escapeHtml(platform.id) + '">' + escapeHtml(platform.shortName || platform.name) + status + '</button>';
  }).join('');
  container.querySelectorAll('[data-preview-platform]').forEach((button) => button.addEventListener('click', () => {
    state.selectedPlatform = button.dataset.previewPlatform;
    renderPreviewPlatformTabs();
    updateLivePreview();
  }));
  const selected = platforms.find((platform) => platform.id === state.selectedPlatform);
  const status = $('#previewPlatformStatus');
  if (status && selected) {
    const description = selected.description || PLATFORM_DESCRIPTIONS[selected.id] || '';
    status.textContent = selected.canPublish ? description : `${description} 目前先提供版型預覽，尚未串接發布。`;
    status.dataset.ready = String(Boolean(selected.canPublish));
  }
}

function renderPlatformOptions(platforms = []) {
  const select = $('#scheduleChannel');
  if (!select || !platforms.length) return;
  select.innerHTML = platforms.map((platform) => {
    const label = platform.enabled ? platform.name : `${platform.name}（即將支援）`;
    return '<option value="' + escapeHtml(platform.id) + '"' + (platform.enabled ? '' : ' disabled') + '>' + escapeHtml(label) + '</option>';
  }).join('');
}

function renderAccountOptions(platformId = 'facebook') {
  const select = $('#scheduleAccount');
  if (!select) return;
  const accounts = state.accounts.filter((account) => account.platformId === platformId);
  select.innerHTML = accounts.length
    ? accounts.map((account) => '<option value="' + escapeHtml(account.id) + '"' + (account.enabled ? '' : ' disabled') + '>' + escapeHtml(account.name) + (account.enabled ? '' : '（尚未連接）') + '</option>').join('')
    : '<option value="" disabled selected>尚未連接帳號</option>';
  const firstEnabled = accounts.find((account) => account.enabled);
  if (firstEnabled) select.value = firstEnabled.id;
}

function selectedPlatformDefinition(platformId = $('#scheduleChannel')?.value || 'facebook') {
  return state.platforms.find((platform) => platform.id === platformId) || null;
}

function renderContentTypeOptions(platformId = 'facebook') {
  const select = $('#scheduleContentType');
  if (!select) return;
  const platform = selectedPlatformDefinition(platformId);
  const contentTypes = platform?.contentTypes || (platformId === 'facebook' ? [{ id: 'post', name: '貼文', canPublish: true }] : []);
  select.innerHTML = contentTypes.length
    ? contentTypes.map((contentType) => '<option value="' + escapeHtml(contentType.id) + '">' + escapeHtml(contentType.name) + (contentType.canPublish ? '' : '（規劃中）') + '</option>').join('')
    : '<option value="" disabled>尚未定義發布格式</option>';
  renderContentSettings(platformId, select.value);
}

function renderContentSettings(platformId = $('#scheduleChannel')?.value || 'facebook', contentTypeId = $('#scheduleContentType')?.value || 'post') {
  const container = $('#scheduleContentSettings');
  if (!container) return;
  const platform = selectedPlatformDefinition(platformId);
  const contentType = platform?.contentTypes?.find((item) => item.id === contentTypeId);
  if (!contentType) {
    container.innerHTML = '';
    return;
  }
  const settings = contentType.settings || [];
  container.innerHTML = '<p class="content-type-description">' + escapeHtml(contentType.description || '') + '</p>' + settings.map((setting) => {
    if (setting.type === 'select') {
      return '<label class="field"><span>' + escapeHtml(setting.name) + '</span><select data-content-setting="' + escapeHtml(setting.id) + '">' + setting.options.map((option) => '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>').join('') + '</select></label>';
    }
    return '<label class="field"><span>' + escapeHtml(setting.name) + '</span><input type="text" data-content-setting="' + escapeHtml(setting.id) + '" placeholder="' + escapeHtml(setting.placeholder || '') + '" /></label>';
  }).join('');
  const submit = $('#scheduleSubmitButton');
  if (submit) {
    submit.disabled = !contentType.canPublish;
    submit.title = contentType.canPublish ? '' : '此格式尚未串接發布功能';
  }
}

function readContentSettings() {
  return Object.fromEntries([...document.querySelectorAll('[data-content-setting]')].map((field) => [field.dataset.contentSetting, field.value]));
}

function renderCreatePublishSpec() {
  const platformSelect = $('#createChannel');
  const accountSelect = $('#createAccount');
  const typeSelect = $('#createContentType');
  if (!platformSelect || !accountSelect || !typeSelect) return;
  const platforms = state.platforms.length ? state.platforms : [];
  platformSelect.innerHTML = platforms.map((platform) => '<option value="' + escapeHtml(platform.id) + '">' + escapeHtml(platform.name) + '</option>').join('');
  if (!platformSelect.value) platformSelect.value = 'facebook';
  const platformId = platformSelect.value || 'facebook';
  const accounts = state.accounts.filter((account) => account.platformId === platformId);
  accountSelect.innerHTML = accounts.length
    ? accounts.map((account) => '<option value="' + escapeHtml(account.id) + '"' + (account.enabled ? '' : ' disabled') + '>' + escapeHtml(account.name) + (account.enabled ? '' : '（尚未連接）') + '</option>').join('')
    : '<option value="" disabled>尚未連接帳號</option>';
  const firstAccount = accounts.find((account) => account.enabled);
  if (firstAccount) accountSelect.value = firstAccount.id;
  const platform = state.platforms.find((item) => item.id === platformId);
  const contentTypes = platform?.contentTypes || [];
  typeSelect.innerHTML = contentTypes.map((contentType) => '<option value="' + escapeHtml(contentType.id) + '">' + escapeHtml(contentType.name) + (contentType.canPublish ? '' : '（規劃中）') + '</option>').join('');
  renderCreateContentSettings(platformId, typeSelect.value);
}

function renderCreateContentSettings(platformId, contentTypeId) {
  const container = $('#createContentSettings');
  const platform = state.platforms.find((item) => item.id === platformId);
  const contentType = platform?.contentTypes?.find((item) => item.id === contentTypeId);
  if (!container || !contentType) return;
  container.innerHTML = '<p class="content-type-description">' + escapeHtml(contentType.description || '') + '</p>' + (contentType.settings || []).map((setting) => {
    if (setting.type === 'select') return '<label class="field"><span>' + escapeHtml(setting.name) + '</span><select data-create-content-setting="' + escapeHtml(setting.id) + '">' + setting.options.map((option) => '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>').join('') + '</select></label>';
    return '<label class="field"><span>' + escapeHtml(setting.name) + '</span><input type="text" data-create-content-setting="' + escapeHtml(setting.id) + '" placeholder="' + escapeHtml(setting.placeholder || '') + '" /></label>';
  }).join('');
}

function readCreateContentSettings() {
  return Object.fromEntries([...document.querySelectorAll('[data-create-content-setting]')].map((field) => [field.dataset.createContentSetting, field.value]));
}

document.querySelectorAll('[data-view-target]').forEach((tab) => {
  tab.addEventListener('click', () => setActiveView(tab.dataset.viewTarget));
});

function showToast(message, type = 'info') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3600);
}

function setFormMessage(message, type = '') {
  const element = $('#formMessage');
  element.textContent = message;
  element.dataset.type = type;
}

function setPreviewMessage(message, type = '') {
  const element = $('#previewMessage');
  element.textContent = message;
  element.dataset.type = type;
}

function setLoading(isLoading) {
  const button = $('#generateButton');
  button.disabled = isLoading;
  button.innerHTML = isLoading ? '<span class="spinner"></span> AI 讀取媒體中…' : '<span>✦</span> AI 產生文案';
}

function isVideoPath(value = '') {
  return /\.(mp4|m4v|mov|mpeg|mpg|webm|ogv|avi)(?:[?#]|$)/i.test(value);
}

function mediaPathsOf(record = {}) {
  if (Array.isArray(record.mediaPaths) && record.mediaPaths.length) return record.mediaPaths;
  return record.imagePath ? [record.imagePath] : [];
}

function renderSavedMedia(items) {
  const gallery = $('#previewMediaGallery');
  const normalized = items.map((item) => typeof item === 'string'
    ? { source: item, type: isVideoPath(item) ? 'video' : 'image', name: '' }
    : item);
  gallery.innerHTML = normalized.map((item, index) => {
    const source = item.source || '';
    const safeSource = escapeHtml(source);
    const label = escapeHtml(item.name || ('媒體 ' + (index + 1)));
    const isVideo = item.type === 'video' || String(item.type).startsWith('video/') || isVideoPath(source);
    return isVideo
      ? '<figure class="media-item"><video src="' + safeSource + '" controls playsinline preload="metadata" aria-label="' + label + '"></video></figure>'
      : '<figure class="media-item"><img src="' + safeSource + '" alt="' + label + '" loading="lazy" /></figure>';
  }).join('');
  $('#previewImageWrap').classList.toggle('empty', normalized.length === 0);
}

function renderGenerated(generated, { syncSelectedMedia = false } = {}) {
  state.generated = generated;
  if (syncSelectedMedia && state.selectedMediaItems.length) {
    const paths = mediaPathsOf(generated);
    state.selectedMediaItems.forEach((item, index) => {
      item.serverPath = paths[index] || '';
    });
  }
  $('#facebookText').value = generated.facebook || '';
  $('#reelText').value = generated.reel || '';
  if (generated.defaultHashtags !== undefined) $('#defaultHashtags').value = generated.defaultHashtags;
  if (generated.channel && $('#createChannel')) {
    $('#createChannel').value = generated.channel;
    renderCreatePublishSpec();
    if (generated.accountId) $('#createAccount').value = generated.accountId;
    if (generated.contentType) {
      $('#createContentType').value = generated.contentType;
      renderCreateContentSettings(generated.channel, generated.contentType);
    }
  }
  const hashtags = Array.isArray(generated.hashtags) && generated.hashtags.length
    ? generated.hashtags
    : DEFAULT_HASHTAGS;
  $('#hashtagsText').value = hashtags.join(' ');
  $('#draftState').textContent = '可編輯';
  $('#draftState').classList.add('ready');
  $('#saveButton').disabled = false;
  $('#scheduleButton').disabled = !state.savedPost;
  renderSavedMedia(mediaPathsOf(generated));
  updateLivePreview();
}

function currentDraft() {
  const selectedServerPaths = state.selectedMediaItems.map((item) => item.serverPath).filter(Boolean);
  const mediaPaths = selectedServerPaths.length ? selectedServerPaths : mediaPathsOf(state.generated || {});
  return {
    ...(state.generated || {}),
    godName: $('#godName').value,
    postType: $('#postType').value,
    extraNotes: $('#extraNotes').value,
    defaultHashtags: $('#defaultHashtags').value,
    channel: $('#createChannel').value,
    accountId: $('#createAccount').value,
    contentType: $('#createContentType').value,
    contentSettings: readCreateContentSettings(),
    facebook: $('#facebookText').value,
    reel: $('#reelText').value,
    hashtags: $('#hashtagsText').value.split(/\s+/).map((tag) => tag.trim()).filter(Boolean),
    imagePath: mediaPaths[0] || '',
    mediaPaths,
  };
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function renderPosts() {
  const container = $('#postsList');
  if (!state.posts.length) {
    container.className = 'list-empty';
    container.textContent = '還沒有草稿，先產生一篇吧。';
    return;
  }
  container.className = 'record-list';
  container.innerHTML = state.posts.slice(0, 8).map((post) => {
    const firstMedia = mediaPathsOf(post)[0];
    const thumbnail = !firstMedia ? '✦' : isVideoPath(firstMedia)
      ? '<video src="' + escapeHtml(firstMedia) + '" muted playsinline preload="metadata"></video>'
      : '<img src="' + escapeHtml(firstMedia) + '" alt="" />';
    const excerpt = escapeHtml(post.facebook.slice(0, 72)) + (post.facebook.length > 72 ? '…' : '');
    return '<button class="record-card" data-post-id="' + post.id + '" type="button">' +
      '<span class="record-thumb">' + thumbnail + '</span>' +
      '<span class="record-body"><strong>' + escapeHtml(post.godName) + '</strong><small>' + formatDate(post.createdAt) + ' ・ ' + escapeHtml(post.postType) + '</small><span>' + excerpt + '</span></span>' +
      '<span class="record-arrow">›</span></button>';
  }).join('');
  container.querySelectorAll('[data-post-id]').forEach((button) => button.addEventListener('click', () => loadPost(button.dataset.postId)));
}

function renderSchedule() {
  const container = $('#scheduleList');
  if (!state.schedule.length) {
    container.className = 'list-empty';
    container.textContent = '還沒有排程。';
    return;
  }
  container.className = 'record-list';
  const statusLabels = {
    pending: '待發布',
    publishing: '發布中',
    retrying: '等待重試',
    published: '已發布',
    failed: '發布失敗',
  };
  container.innerHTML = state.schedule.slice(0, 8).map((item) => {
    const post = state.posts.find((record) => record.id === item.postId);
    const name = escapeHtml(post ? post.godName : '未命名貼文');
    const status = statusLabels[item.status] || item.status;
    const error = item.lastError?.message ? ' title="' + escapeHtml(item.lastError.message) + '"' : '';
    const attempts = item.attempts > 1 ? ' · 第 ' + item.attempts + ' 次' : '';
    const channel = PLATFORM_NAMES[item.channel] || item.channel || '未指定平台';
    const account = state.accounts.find((entry) => entry.id === item.accountId);
    const accountName = account?.name || item.accountId || '未指定帳號';
    const platform = state.platforms.find((entry) => entry.id === item.channel);
    const contentType = platform?.contentTypes?.find((entry) => entry.id === item.contentType);
    const format = contentType?.name || item.contentType || '貼文';
    return '<div class="schedule-card"' + error + '><span class="calendar-icon">' + new Date(item.scheduledAt).getDate() + '</span><span><strong>' + name + '</strong><small>' + escapeHtml(channel) + ' ・ ' + escapeHtml(accountName) + ' ・ ' + escapeHtml(format) + ' ・ ' + formatDate(item.scheduledAt) + attempts + '</small></span><em data-status="' + escapeHtml(item.status) + '">' + escapeHtml(status) + '</em></div>';
  }).join('');
}

function escapeHtml(value = '') {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
  return String(value).replace(/[&<>'"]/g, (character) => entities[character]);
}

async function loadPost(postId) {
  const post = state.posts.find((record) => record.id === postId);
  if (!post) return;
  state.savedPost = post;
  renderGenerated(post);
  setActiveView('review');
  setPreviewMessage('已載入草稿，可以繼續修改。');
  window.scrollTo({ top: $('.preview-panel').offsetTop - 24, behavior: 'smooth' });
}

async function loadData() {
  const [gods, posts, schedule, config] = await Promise.all([api('/api/gods'), api('/api/posts'), api('/api/schedule'), api('/api/config')]);
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
  renderPreviewPlatformTabs();
  renderPlatformOptions(config.publishingPlatforms);
  renderAccountOptions('facebook');
  renderContentTypeOptions('facebook');
  renderCreatePublishSpec();
  renderPosts();
  renderSchedule();
  const status = $('#apiStatus');
  const aiStatus = config.aiConfigured ? config.provider + ' 已連線' : 'Gemini 未連線';
  const facebookLabel = facebookStatus.connected
    ? 'Facebook 已連線' + (facebookStatus.page?.name ? '：' + facebookStatus.page.name : '')
    : config.facebookConfigured ? 'Facebook 驗證失敗' : 'Facebook 未設定';
  status.textContent = aiStatus + ' · ' + facebookLabel;
  status.title = facebookStatus.error || '';
  status.dataset.ready = config.aiConfigured && facebookStatus.connected ? 'true' : 'false';
  if (config.aiConfigured) {
    setFormMessage(facebookStatus.connected
      ? '圖片與影片會送到 Gemini 產生文案，排程到期後會發布到 Facebook 粉專。'
      : config.facebookConfigured
        ? 'Gemini 已可使用；Facebook 憑證驗證失敗，請查看右上角提示。'
        : 'Gemini 已可使用；若要自動發布，請先在 .env 設定 Facebook 粉專憑證。');
  }
}

function clearUploadPreview() {
  state.selectedMediaItems.forEach((item) => URL.revokeObjectURL(item.source));
  state.uploadPreviewUrls = [];
  state.selectedMediaItems = [];
  $('#uploadPreviewGallery').innerHTML = '';
  $('#uploadZone').classList.remove('has-media');
  renderSavedMedia([]);
}

function syncSelectedMediaFiles() {
  const transfer = new DataTransfer();
  state.selectedMediaItems.forEach((item) => transfer.items.add(item.file));
  $('#imageInput').files = transfer.files;
}

function moveSelectedMedia(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.selectedMediaItems.length || toIndex >= state.selectedMediaItems.length) return;
  const [item] = state.selectedMediaItems.splice(fromIndex, 1);
  state.selectedMediaItems.splice(toIndex, 0, item);
  syncSelectedMediaFiles();
  renderUploadPreview();
  renderSavedMedia(state.selectedMediaItems);
  setFormMessage('已調整順序；第 1 張會作為主要圖片。', 'success');
}

function renderUploadPreview() {
  const gallery = $('#uploadPreviewGallery');
  gallery.innerHTML = '';
  state.selectedMediaItems.forEach((item, index) => {
    const figure = document.createElement('figure');
    figure.className = 'media-item sortable-media-item';
    figure.draggable = true;
    figure.dataset.index = String(index);
    figure.title = '拖曳調整順序';
    const media = document.createElement(item.file.type.startsWith('video/') ? 'video' : 'img');
    media.src = item.source;
    media.setAttribute('aria-label', '已選媒體 ' + (index + 1));
    if (media.tagName === 'VIDEO') {
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
    } else {
      media.alt = item.file.name;
    }
    const badge = document.createElement('span');
    badge.className = 'media-order-badge';
    badge.textContent = String(index + 1);
    const controls = document.createElement('span');
    controls.className = 'media-order-controls';
    controls.innerHTML = '<button type="button" data-media-move="up" aria-label="上移"' + (index === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" data-media-move="down" aria-label="下移"' + (index === state.selectedMediaItems.length - 1 ? ' disabled' : '') + '>↓</button>';
    figure.append(media, badge, controls);
    gallery.append(figure);
  });
}

function bindUploadReordering() {
  const gallery = $('#uploadPreviewGallery');
  gallery.addEventListener('click', (event) => {
    const button = event.target.closest('[data-media-move]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const figure = button.closest('.sortable-media-item');
    const index = Number(figure?.dataset.index);
    const offset = button.dataset.mediaMove === 'up' ? -1 : 1;
    moveSelectedMedia(index, index + offset);
  });
  gallery.addEventListener('dragstart', (event) => {
    const figure = event.target.closest('.sortable-media-item');
    if (!figure) return;
    state.mediaDragIndex = Number(figure.dataset.index);
    figure.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(state.mediaDragIndex));
  });
  gallery.addEventListener('dragover', (event) => {
    const figure = event.target.closest('.sortable-media-item');
    if (!figure || state.mediaDragIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    gallery.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));
    figure.classList.add('drag-over');
  });
  gallery.addEventListener('drop', (event) => {
    const figure = event.target.closest('.sortable-media-item');
    if (!figure || state.mediaDragIndex === null) return;
    event.preventDefault();
    const targetIndex = Number(figure.dataset.index);
    moveSelectedMedia(state.mediaDragIndex, targetIndex);
    state.mediaDragIndex = null;
  });
  gallery.addEventListener('dragend', () => {
    state.mediaDragIndex = null;
    gallery.querySelectorAll('.dragging, .drag-over').forEach((item) => item.classList.remove('dragging', 'drag-over'));
  });
}

function previewSelectedMedia(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) {
    clearUploadPreview();
    return false;
  }
  if (files.length > 10) {
    $('#imageInput').value = '';
    clearUploadPreview();
    setFormMessage('一次最多選擇 10 個檔案。', 'error');
    return false;
  }
  const unsupported = files.find((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'));
  if (unsupported) {
    $('#imageInput').value = '';
    clearUploadPreview();
    setFormMessage('「' + unsupported.name + '」不是圖片或影片。', 'error');
    return false;
  }
  const oversized = files.find((file) => file.size > 20 * 1024 * 1024);
  if (oversized) {
    $('#imageInput').value = '';
    clearUploadPreview();
    setFormMessage('「' + oversized.name + '」超過 20MB。', 'error');
    return false;
  }

  clearUploadPreview();
  state.generated = null;
  state.selectedMediaItems = files.map((file) => {
    const source = URL.createObjectURL(file);
    state.uploadPreviewUrls.push(source);
    return { file, source, type: file.type, name: file.name };
  });
  renderUploadPreview();
  renderSavedMedia(state.selectedMediaItems);
  $('#uploadZone').classList.add('has-media');
  state.savedPost = null;
  $('#draftState').textContent = '待產生';
  $('#saveButton').disabled = true;
  $('#scheduleButton').disabled = true;
  const imageCount = files.filter((file) => file.type.startsWith('image/')).length;
  const videoCount = files.length - imageCount;
  setFormMessage('已選擇 ' + files.length + ' 個檔案（圖片 ' + imageCount + '、影片 ' + videoCount + '）。', 'success');
  return true;
}

$('#imageInput').addEventListener('change', (event) => {
  previewSelectedMedia(event.target.files);
});

$('#facebookText').addEventListener('input', updateLivePreview);
$('#hashtagsText').addEventListener('input', updateLivePreview);
renderPreviewPlatformTabs();
updateLivePreview();

const uploadZone = $('#uploadZone');
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
  $('#imageInput').files = transfer.files;
  $('#imageInput').dispatchEvent(new Event('change', { bubbles: true }));
});

bindUploadReordering();

$('#generateForm').addEventListener('submit', async (event) => {
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
    setPreviewMessage('可直接修改文字，確認後再儲存。');
  } catch (error) {
    setFormMessage(error.message, 'error');
    showToast(error.message, 'error');
  } finally {
    setLoading(false);
  }
});

$('#saveButton').addEventListener('click', async () => {
  const draft = currentDraft();
  if (!draft.facebook.trim()) return setPreviewMessage('Facebook 文案不能是空白。', 'error');
  try {
    const saved = state.savedPost
      ? await api('/api/posts/' + state.savedPost.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      : await api('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    state.savedPost = saved;
    state.generated = saved;
    $('#draftState').textContent = '已儲存';
    $('#scheduleButton').disabled = false;
    await refreshLists();
    setPreviewMessage('草稿已儲存到 data/posts.json。', 'success');
    showToast('草稿已儲存', 'success');
  } catch (error) {
    setPreviewMessage(error.message, 'error');
  }
});

$('#scheduleButton').addEventListener('click', () => {
  if (!state.savedPost) return setPreviewMessage('請先儲存草稿，再安排時間。', 'error');
  const dialog = $('#scheduleDialog');
  const now = new Date(Date.now() + 60 * 60 * 1000);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('#scheduledAt').value = now.toISOString().slice(0, 16);
  $('#scheduleChannel').value = 'facebook';
  renderAccountOptions('facebook');
  renderContentTypeOptions('facebook');
  dialog.showModal();
});

$('#scheduleChannel').addEventListener('change', (event) => {
  renderAccountOptions(event.target.value);
  renderContentTypeOptions(event.target.value);
});
$('#scheduleContentType').addEventListener('change', (event) => renderContentSettings($('#scheduleChannel').value, event.target.value));

$('#createChannel').addEventListener('change', () => renderCreatePublishSpec());
$('#createContentType').addEventListener('change', (event) => renderCreateContentSettings($('#createChannel').value, event.target.value));

$('#scheduleForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: state.savedPost.id, scheduledAt: new Date($('#scheduledAt').value).toISOString(), channel: $('#scheduleChannel').value, accountId: $('#scheduleAccount').value, contentType: $('#scheduleContentType').value, contentSettings: readContentSettings() }) });
    $('#scheduleDialog').close();
    await refreshLists();
    const message = state.config?.facebookConnected
      ? '排程已儲存，到期後會自動發布到 Facebook。'
      : '排程已儲存；設定 Facebook 憑證後才會自動發布。';
    setPreviewMessage(message, state.config?.facebookConnected ? 'success' : '');
    showToast(message, state.config?.facebookConnected ? 'success' : 'info');
  } catch (error) {
    setPreviewMessage(error.message, 'error');
  }
});

async function refreshLists() {
  state.posts = await api('/api/posts');
  state.schedule = await api('/api/schedule');
  renderPosts();
  renderSchedule();
}

$('#refreshButton').addEventListener('click', async () => {
  await refreshLists();
  showToast('資料已重新整理', 'success');
});

loadData().catch((error) => showToast(error.message, 'error'));
