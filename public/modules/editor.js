import { $, escapeHtml, isVideoPath, setPreviewMessage, showToast, fieldValue, setFieldValue } from './dom.js';
import { state, DEFAULT_HASHTAGS, PLATFORM_NAMES, mediaPathsOf, currentClient } from './state.js';
import {
  renderCreatePublishSpec,
  renderCreateContentSettings,
  readCreateContentSettings,
  readTargetContentSettings,
} from './platform-ui.js';
import { api } from './api.js';
import {
  buildTargetsPayload,
  getActiveTarget,
  getMotherCopyForActiveTarget,
  renderTargetAccountControls,
  applyActiveTargetToEditor,
} from './targets-ui.js';
import { renderPlatformStrategy } from './platform-strategy.js';

export function updateLivePreview() {
  const contentType = fieldValue($('#targetContentType')) || 'post';
  const text = contentType === 'reel'
    ? ($('#reelText')?.value?.trim() || $('#facebookText')?.value?.trim() || '')
    : ($('#facebookText')?.value?.trim() || '');
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
    if (title) {
      title.textContent = contentType === 'reel'
        ? 'Reel 預覽'
        : contentType === 'story'
          ? '限時預覽'
          : '貼文預覽';
    }
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
  renderPlatformStrategy(state.selectedPlatform);
  if (!selected) {
    status.hidden = false;
    status.textContent = '請先勾選要發的平台。';
    status.dataset.ready = 'false';
    return;
  }

  // 平台名已在上方「目標平台」顯示，此處只補非重複提示
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

function syncEditorActions() {
  const hasSavedPost = Boolean(state.savedPost);
  const isDirty = Boolean(state.editorDirty);
  const scheduleButton = $('#scheduleButton');
  const publishButton = $('#publishNowButton');
  if (scheduleButton) scheduleButton.disabled = !hasSavedPost || isDirty;
  if (publishButton) {
    publishButton.disabled = !hasSavedPost || isDirty || publishButton.dataset.busy === 'true';
  }
  const badge = $('#draftState');
  if (badge && hasSavedPost) {
    badge.textContent = isDirty ? '有未儲存變更' : '已儲存';
    badge.classList.toggle('ready', !isDirty);
  }
}

export function markEditorDirty(isDirty = true) {
  state.editorDirty = Boolean(isDirty);
  syncEditorActions();
}

export function renderGenerated(generated, { syncSelectedMedia = false } = {}) {
  state.generated = generated;
  state.editorDirty = !state.savedPost;
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
  const contentTopic = $('#contentTopic');
  if ((generated.contentTopic || generated.godName) && contentTopic) contentTopic.value = generated.contentTopic || generated.godName;
  const extraNotes = $('#extraNotes');
  if (generated.extraNotes !== undefined && extraNotes) extraNotes.value = generated.extraNotes;
  const postTypeRadio = document.querySelector('input[name="postType"][value="' + (generated.postType || 'intro') + '"]');
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
  if (scheduleBtn) scheduleBtn.disabled = !state.savedPost || state.editorDirty;
  syncEditorActions();
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
  const contentTopic = $('#contentTopic')?.value || '';
  const draft = {
    ...(state.generated || {}),
    clientId: state.currentClientId || '',
    contentTopic,
    godName: contentTopic,
    postType: document.querySelector('input[name="postType"]:checked')?.value || 'intro',
    extraNotes: $('#extraNotes')?.value || '',
    defaultHashtags: $('#defaultHashtags')?.value || '',
    channel: activeAccount?.platformId || 'facebook',
    accountId: state.activeTargetId || activeAccount?.id || '',
    contentType: fieldValue($('#createContentType')) || fieldValue($('#targetContentType')) || 'post',
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
  const reelText = $('#reelText');
  if (reelText) reelText.addEventListener('input', updateLivePreview);
  const tagsText = $('#hashtagsText');
  if (tagsText) tagsText.addEventListener('input', updateLivePreview);

  const rewriteButton = $('#btnRewritePlatform');
  if (rewriteButton) {
    rewriteButton.addEventListener('click', async () => {
      const target = getActiveTarget();
      const account = (currentClient()?.accounts || state.accounts || []).find((item) => item.id === state.activeTargetId);
      const contentType = fieldValue($('#targetContentType')) || target?.contentType || 'post';
      const input = contentType === 'reel' ? $('#reelText') : $('#facebookText');
      const sourceCopy = input?.value?.trim() || getMotherCopyForActiveTarget(target);
      if (!account?.platformId || !sourceCopy) return setPreviewMessage('請先準備平台與母稿文案。', 'error');
      rewriteButton.disabled = true;
      rewriteButton.dataset.busy = 'true';
      try {
        const rewritten = await api('/api/rewrite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platformId: account.platformId,
            contentType,
            sourceCopy,
            contentTopic: $('#contentTopic')?.value || '',
            extraNotes: $('#extraNotes')?.value || '',
          }),
        });
        if (input) input.value = rewritten.copy || '';
        const mode = $('#platformCopyMode');
        if (mode) {
          mode.textContent = '已覆寫此平台文案';
          mode.dataset.mode = 'overridden';
        }
        const restoreButton = $('#btnRestoreMotherCopy');
        if (restoreButton) restoreButton.disabled = false;
        markEditorDirty();
        updateLivePreview();
        setPreviewMessage(`${PLATFORM_NAMES[account.platformId] || account.platformId} 已完成 AI 改寫，儲存後套用。`, 'success');
      } catch (error) {
        setPreviewMessage(error.message, 'error');
      } finally {
        rewriteButton.disabled = false;
        rewriteButton.dataset.busy = 'false';
      }
    });
  }

  const restoreButton = $('#btnRestoreMotherCopy');
  if (restoreButton) {
    restoreButton.addEventListener('click', () => {
      const target = getActiveTarget();
      const contentType = fieldValue($('#targetContentType')) || target?.contentType || 'post';
      const input = contentType === 'reel' ? $('#reelText') : $('#facebookText');
      if (input) input.value = getMotherCopyForActiveTarget(target);
      const mode = $('#platformCopyMode');
      if (mode) {
        mode.textContent = '沿用母稿';
        mode.dataset.mode = 'inherited';
      }
      restoreButton.disabled = true;
      markEditorDirty();
      updateLivePreview();
    });
  }

  const composerForm = $('#generateForm');
  composerForm?.addEventListener('input', (event) => {
    const target = event.target;
    if (target?.matches?.('#contentTopic, #extraNotes, #defaultHashtags, #facebookText, #reelText, #hashtagsText, #targetScheduledAt')
      || target?.closest?.('#targetContentSettings')) {
      markEditorDirty();
    }
  });
  composerForm?.addEventListener('change', (event) => {
    const target = event.target;
    if (target?.closest?.('#targetAccountChecks, #targetContentType, #targetContentSettings')
      || target?.matches?.('#targetScheduledAt')) {
      markEditorDirty();
    }
  });

  const saveBtn = $('#saveButton');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const draft = currentDraft();
      const type = fieldValue($('#targetContentType')) || draft.contentType || 'post';
      if (type === 'reel') {
        if (!String(draft.reel || '').trim()) return setPreviewMessage('Reel 文案不能是空白。', 'error');
      } else if (!String(draft.facebook || '').trim()) {
        return setPreviewMessage('文案不能是空白。', 'error');
      }
      try {
        const saved = state.savedPost
          ? await api('/api/posts/' + state.savedPost.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
          : await api('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        state.savedPost = saved;
        state.generated = saved;
        state.editorDirty = false;
        const badge = $('#draftState');
        if (badge) badge.textContent = '已儲存';
        syncEditorActions();
        if (typeof refreshListsFn === 'function') await refreshListsFn();
        setPreviewMessage('草稿已儲存到 data/posts.json。', 'success');
        showToast('草稿已儲存', 'success');
      } catch (error) {
        setPreviewMessage(error.message, 'error');
      }
    });
  }

  const publishButton = $('#publishNowButton');
  publishButton?.addEventListener('click', async () => {
    const post = state.savedPost;
    if (!post) return setPreviewMessage('請先儲存草稿，再立即發布。', 'error');
    if (state.editorDirty) return setPreviewMessage('內容有未儲存變更，請先儲存草稿。', 'error');

    const targets = Array.isArray(post.targets) ? post.targets : [];
    const target = targets.find((item) => item.id === state.activeTargetId || item.accountId === state.activeTargetId)
      || targets[0];
    if (!target?.id) return setPreviewMessage('請先選擇要發布的平台。', 'error');

    const platformName = PLATFORM_NAMES[target.platformId] || target.platformId;
    if (['scheduled', 'publishing', 'pending'].includes(target.status)) {
      return setPreviewMessage(
        target.status === 'scheduled'
          ? `${platformName} 已排程，請先取消排程再立即發布。`
          : `${platformName} 正在處理中，請稍後再試。`,
        'error',
      );
    }
    if (target.status === 'published') {
      return setPreviewMessage(`${platformName} 已經發布，請建立副本後再重新發布。`, 'error');
    }
    if (!window.confirm(`確定立即發布到 ${platformName}？`)) return;

    publishButton.dataset.busy = 'true';
    syncEditorActions();
    setPreviewMessage(`正在發布到 ${platformName}…`, 'info');
    try {
      await api('/api/publish/target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.id, targetId: target.id }),
      });
      if (typeof refreshListsFn === 'function') await refreshListsFn();
      const refreshedPost = state.posts.find((item) => item.id === post.id);
      if (refreshedPost) {
        state.savedPost = refreshedPost;
        state.generated = refreshedPost;
        state.editorDirty = false;
        renderGenerated(refreshedPost);
      }
      setPreviewMessage(`${platformName} 已發布。`, 'success');
      showToast(`${platformName} 已發布。`, 'success');
    } catch (error) {
      if (typeof refreshListsFn === 'function') await refreshListsFn();
      setPreviewMessage(error.message || `${platformName} 發布失敗。`, 'error');
      showToast(error.message || `${platformName} 發布失敗。`, 'error');
    } finally {
      publishButton.dataset.busy = 'false';
      syncEditorActions();
    }
  });
}
