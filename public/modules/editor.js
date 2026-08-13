import { $, escapeHtml, isVideoPath, setPreviewMessage, showToast, fieldValue, setFieldValue } from './dom.js';
import { state, DEFAULT_HASHTAGS, PLATFORM_NAMES, mediaPathsOf, currentClient } from './state.js';
import {
  renderCreatePublishSpec,
  renderCreateContentSettings,
  readCreateContentSettings,
  readTargetContentSettings,
} from './platform-ui.js';
import { api } from './api.js';
import { buildTargetsPayload, renderTargetAccountControls, applyActiveTargetToEditor } from './targets-ui.js';

export function updateLivePreview() {
  const text = $('#facebookText')?.value?.trim() || '';
  const preview = $('#facebookPreview');
  if (preview) {
    preview.innerHTML = text
      ? text.split(/\n{2,}/).map((paragraph) => '<p>' + escapeHtml(paragraph).replace(/\n/g, '<br>') + '</p>').join('')
      : '尚未產生文案。';
  }
  const hashtagsPreview = $('#hashtagsPreview');
  if (hashtagsPreview) hashtagsPreview.textContent = $('#hashtagsText')?.value?.trim() || '';
  const previewCard = document.querySelector('.copy-card');
  if (previewCard) {
    previewCard.dataset.platform = state.selectedPlatform;
    const title = previewCard.querySelector('h4');
    // 目標帳號已在上方選取；標題不重複平台／帳號名
    if (title) title.textContent = '貼文預覽';
  }
  const mediaWrap = $('#previewImageWrap');
  if (mediaWrap) mediaWrap.dataset.platform = state.selectedPlatform;
}

export function renderPreviewPlatformTabs() {
  const status = $('#previewPlatformStatus');
  if (!status) return;

  const platforms = state.platforms.length
    ? state.platforms
    : Object.keys(PLATFORM_NAMES).map((id) => ({ id, name: PLATFORM_NAMES[id], shortName: PLATFORM_NAMES[id], canPublish: id === 'facebook' }));

  const accounts = currentClient()?.accounts || state.accounts || [];
  const activeAccount = accounts.find((account) => account.id === state.activeTargetId);
  if (activeAccount?.platformId) state.selectedPlatform = activeAccount.platformId;
  if (!platforms.some((platform) => platform.id === state.selectedPlatform)) {
    state.selectedPlatform = platforms[0]?.id || 'facebook';
  }

  const selected = platforms.find((platform) => platform.id === state.selectedPlatform);
  if (!selected) {
    status.hidden = false;
    status.textContent = '請先勾選要發的帳號。';
    status.dataset.ready = 'false';
    return;
  }

  // 平台／帳號名已在上方「目標帳號」顯示，此處只補非重複提示
  const publishHint = selected.canPublish ? '' : '目前僅預覽版型，尚未串接真發';
  status.textContent = publishHint;
  status.hidden = !publishHint;
  status.dataset.ready = String(Boolean(selected.canPublish));
}

export function renderSavedMedia(items = []) {
  const gallery = $('#previewMediaGallery');
  if (!gallery) return;
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
  const wrap = $('#previewImageWrap');
  if (wrap) wrap.classList.toggle('empty', normalized.length === 0);
}

export function renderGenerated(generated, { syncSelectedMedia = false } = {}) {
  state.generated = generated;
  if (syncSelectedMedia && state.selectedMediaItems.length) {
    const paths = mediaPathsOf(generated);
    state.selectedMediaItems.forEach((item, index) => {
      item.serverPath = paths[index] || '';
    });
  }
  const fbText = $('#facebookText');
  if (fbText) fbText.value = generated.facebook || '';
  const reelText = $('#reelText');
  if (reelText) reelText.value = generated.reel || '';
  const defaultTags = $('#defaultHashtags');
  if (generated.defaultHashtags !== undefined && defaultTags) defaultTags.value = generated.defaultHashtags;
  const godName = $('#godName');
  if (generated.godName && godName) godName.value = generated.godName;
  const extraNotes = $('#extraNotes');
  if (generated.extraNotes !== undefined && extraNotes) extraNotes.value = generated.extraNotes;
  const postTypeRadio = document.querySelector('input[name="postType"][value="' + (generated.postType || 'work') + '"]');
  if (postTypeRadio) postTypeRadio.checked = true;
  if (generated.contentType) {
    setFieldValue($('#createContentType'), generated.contentType);
    renderCreatePublishSpec();
    renderCreateContentSettings('facebook', generated.contentType);
  }
  if (Array.isArray(generated.targets) && generated.targets.length) {
    state.selectedTargetAccountIds = generated.targets.map((target) => target.accountId).filter(Boolean);
    state.activeTargetId = generated.targets[0].accountId || generated.targets[0].id || '';
  } else if (generated.accountId) {
    state.selectedTargetAccountIds = [generated.accountId];
    state.activeTargetId = generated.accountId;
  }
  renderTargetAccountControls();
  applyActiveTargetToEditor();
  const hashtags = Array.isArray(generated.hashtags) && generated.hashtags.length
    ? generated.hashtags
    : DEFAULT_HASHTAGS;
  const tagsText = $('#hashtagsText');
  if (tagsText) tagsText.value = hashtags.join(' ');
  const badge = $('#draftState');
  if (badge) {
    badge.textContent = '可編輯';
    badge.classList.add('ready');
  }
  const saveBtn = $('#saveButton');
  if (saveBtn) saveBtn.disabled = false;
  const scheduleBtn = $('#scheduleButton');
  if (scheduleBtn) scheduleBtn.disabled = !state.savedPost;
  renderSavedMedia(mediaPathsOf(generated));
  renderPreviewPlatformTabs();
  updateLivePreview();
}

export function currentDraft() {
  const selectedServerPaths = state.selectedMediaItems.map((item) => item.serverPath).filter(Boolean);
  const mediaPaths = selectedServerPaths.length ? selectedServerPaths : mediaPathsOf(state.generated || {});
  const motherFacebook = state.savedPost?.facebook || state.generated?.facebook || '';
  const accounts = currentClient()?.accounts || state.accounts || [];
  const activeAccount = accounts.find((account) => account.id === state.activeTargetId)
    || accounts.find((account) => state.selectedTargetAccountIds.includes(account.id))
    || accounts.find((account) => account.platformId === 'facebook')
    || accounts[0]
    || null;
  const draft = {
    ...(state.generated || {}),
    clientId: state.currentClientId || '',
    godName: $('#godName')?.value || '',
    postType: document.querySelector('input[name="postType"]:checked')?.value || 'work',
    extraNotes: $('#extraNotes')?.value || '',
    defaultHashtags: $('#defaultHashtags')?.value || '',
    channel: activeAccount?.platformId || 'facebook',
    accountId: state.activeTargetId || activeAccount?.id || '',
    contentType: fieldValue($('#targetContentType')) || fieldValue($('#createContentType')) || 'post',
    contentSettings: Object.keys(readTargetContentSettings()).length
      ? readTargetContentSettings()
      : readCreateContentSettings(),
    facebook: motherFacebook || $('#facebookText')?.value || '',
    reel: $('#reelText')?.value || '',
    hashtags: $('#hashtagsText')?.value ? $('#hashtagsText').value.split(/\s+/).map((tag) => tag.trim()).filter(Boolean) : [],
    imagePath: mediaPaths[0] || '',
    mediaPaths,
  };
  draft.targets = buildTargetsPayload(draft);
  return draft;
}

export function initEditorListeners(refreshListsFn) {
  const fbText = $('#facebookText');
  if (fbText) fbText.addEventListener('input', updateLivePreview);
  const tagsText = $('#hashtagsText');
  if (tagsText) tagsText.addEventListener('input', updateLivePreview);

  const saveBtn = $('#saveButton');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const draft = currentDraft();
      if (!draft.facebook.trim()) return setPreviewMessage('Facebook 文案不能是空白。', 'error');
      try {
        const saved = state.savedPost
          ? await api('/api/posts/' + state.savedPost.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
          : await api('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        state.savedPost = saved;
        state.generated = saved;
        const badge = $('#draftState');
        if (badge) badge.textContent = '已儲存';
        const scheduleBtn = $('#scheduleButton');
        if (scheduleBtn) scheduleBtn.disabled = false;
        if (typeof refreshListsFn === 'function') await refreshListsFn();
        setPreviewMessage('草稿已儲存到 data/posts.json。', 'success');
        showToast('草稿已儲存', 'success');
      } catch (error) {
        setPreviewMessage(error.message, 'error');
      }
    });
  }
}
