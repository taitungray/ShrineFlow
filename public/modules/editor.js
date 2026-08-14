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
import { postStatusLabel, targetStatusLabel } from './status.js';

const AUTOSAVE_DELAY_MS = 800;
const RECOVERY_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RECOVERY_SNAPSHOT_LIMIT = 20;
const RECOVERY_KEY_PREFIX = 'shrineflow.autosave.snapshot.v1';
const RECOVERY_INDEX_KEY = 'shrineflow.autosave.index.v1';
let refreshListsCallback = null;

function recoveryKey(postId = state.savedPost?.id || 'new') {
  return `${RECOVERY_KEY_PREFIX}:${state.currentClientId || 'default'}:${postId}`;
}

function setAutosaveStatus(message = '', status = 'idle') {
  state.autosaveState = status;
  const element = $('#autosaveStatus');
  if (element) {
    element.textContent = message;
    element.dataset.state = status;
    element.hidden = !message;
  }
  const retryButton = $('#autosaveRetryButton');
  if (retryButton) {
    retryButton.hidden = !['error', 'conflict', 'blocked'].includes(status);
    retryButton.disabled = state.autosaveInFlight;
  }
}

function clearAutosaveTimer() {
  if (state.autosaveTimer) window.clearTimeout(state.autosaveTimer);
  state.autosaveTimer = null;
}

function readRecoveryIndex() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECOVERY_INDEX_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.key && item.savedAt) : [];
  } catch {
    return [];
  }
}

function writeRecoverySnapshot(draft = currentDraft()) {
  if (!state.editorDirty || !draft) return;
  const fields = [
    'clientId', 'contentTopic', 'godName', 'postType', 'extraNotes', 'defaultHashtags',
    'channel', 'accountId', 'contentType', 'contentSettings', 'facebook', 'reel',
    'hashtags', 'imagePath', 'mediaPaths', 'targets',
  ];
  const safeDraft = Object.fromEntries(fields
    .filter((field) => draft[field] !== undefined)
    .map((field) => [field, draft[field]]));
  const key = recoveryKey();
  const snapshot = {
    key,
    postId: state.savedPost?.id || 'new',
    savedAt: new Date().toISOString(),
    baseVersion: Number(state.savedPost?.version || 1),
    draft: safeDraft,
  };
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
    const index = readRecoveryIndex().filter((item) => item.key !== key);
    index.push({ key, savedAt: snapshot.savedAt });
    index.sort((left, right) => new Date(left.savedAt) - new Date(right.savedAt));
    while (index.length > RECOVERY_SNAPSHOT_LIMIT) {
      const removed = index.shift();
      if (removed?.key) localStorage.removeItem(removed.key);
    }
    localStorage.setItem(RECOVERY_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Local recovery is best effort and must never block editing.
  }
}

function scheduleRecoverySnapshot() {
  if (state.autosaveRetryTimer) window.clearTimeout(state.autosaveRetryTimer);
  state.autosaveRetryTimer = window.setTimeout(() => {
    state.autosaveRetryTimer = null;
    writeRecoverySnapshot();
  }, 350);
}

function clearRecoverySnapshot(postId = state.savedPost?.id || 'new') {
  const key = recoveryKey(postId);
  try {
    localStorage.removeItem(key);
    const index = readRecoveryIndex().filter((item) => item.key !== key);
    localStorage.setItem(RECOVERY_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Ignore storage quota and privacy-mode errors.
  }
}

function readRecoverySnapshot(postId) {
  const key = recoveryKey(postId);
  try {
    const snapshot = JSON.parse(localStorage.getItem(key) || 'null');
    const savedAt = new Date(snapshot?.savedAt || '').getTime();
    if (!snapshot || !Number.isFinite(savedAt) || Date.now() - savedAt > RECOVERY_SNAPSHOT_TTL_MS) {
      clearRecoverySnapshot(postId);
      return null;
    }
    return snapshot;
  } catch {
    clearRecoverySnapshot(postId);
    return null;
  }
}
export function restoreRecoverySnapshotForPost(post) {
  if (!post?.id) return false;
  const snapshot = readRecoverySnapshot(post.id);
  if (!snapshot?.draft) return false;
  const snapshotAt = new Date(snapshot.savedAt).getTime();
  const serverAt = new Date(post.updatedAt || post.createdAt || 0).getTime();
  if (Number.isFinite(serverAt) && Number.isFinite(snapshotAt) && snapshotAt <= serverAt) {
    clearRecoverySnapshot(post.id);
    return false;
  }
  state.savedPost = {
    ...post,
    ...snapshot.draft,
    id: post.id,
    version: post.version,
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
  renderGenerated(state.savedPost);
  markEditorDirty(true);
  setAutosaveStatus('已從本機復原未儲存修改，等待自動儲存', 'recovery');
  return true;
}

function draftValidationMessage(draft) {
  const type = fieldValue($('#targetContentType')) || draft.contentType || 'post';
  if (type === 'reel' && !String(draft.reel || '').trim()) return 'Reel 文案尚未完成。';
  if (type !== 'reel' && !String(draft.facebook || '').trim()) return '貼文文案尚未完成。';
  return '';
}

async function saveDraft({ mode = 'manual', intent = state.autosaveIntent } = {}) {
  if (state.autosavePromise) {
    await state.autosavePromise;
    if (mode === 'autosave' && !state.editorDirty) return state.savedPost;
  }

  const draft = currentDraft();
  const validationMessage = draftValidationMessage(draft);
  if (validationMessage) {
    writeRecoverySnapshot(draft);
    setAutosaveStatus(`${validationMessage} 已保留本機草稿`, 'blocked');
    return null;
  }

  const postBeforeSave = state.savedPost;
  const payload = { ...draft };
  if (postBeforeSave) payload.baseVersion = Number(postBeforeSave.version || 1);
  const saveKey = postBeforeSave?.id || 'new';
  state.autosaveInFlight = true;
  setAutosaveStatus(mode === 'autosave' ? '自動儲存中…' : '儲存中…', 'saving');
  syncEditorActions();

  const request = (async () => {
    try {
      const saved = postBeforeSave
        ? await api('/api/posts/' + postBeforeSave.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        : await api('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      state.savedPost = saved;
      if (intent === state.autosaveIntent || mode === 'manual') {
        state.generated = saved;
        state.editorDirty = false;
        clearRecoverySnapshot(saveKey);
        if (!postBeforeSave) clearRecoverySnapshot('new');
        setAutosaveStatus(mode === 'autosave' ? '已自動儲存' : '已儲存', 'saved');
        setPreviewMessage(mode === 'autosave' ? '草稿已自動儲存。' : '貼文已儲存。', 'success');
        if (mode === 'manual') showToast('貼文已儲存', 'success');
      } else {
        setAutosaveStatus('上一版已儲存，正在繼續儲存最新修改…', 'pending');
      }
      if (typeof refreshListsCallback === 'function') await refreshListsCallback();
      return saved;
    } catch (error) {
      if (error.code === 'POST_VERSION_CONFLICT' && error.data?.current) {
        state.savedPost = error.data.current;
      }
      writeRecoverySnapshot(draft);
      setAutosaveStatus(
        error.code === 'POST_VERSION_CONFLICT'
          ? '版本已變更，已保留本機修改；請重試儲存。'
          : '尚未儲存，已保留本機草稿；請重試。',
        error.code === 'POST_VERSION_CONFLICT' ? 'conflict' : 'error',
      );
      throw error;
    } finally {
      state.autosaveInFlight = false;
      state.autosavePromise = null;
      syncEditorActions();
      if (state.editorDirty && intent !== state.autosaveIntent && mode === 'autosave') scheduleAutosave(0);
    }
  })();
  state.autosavePromise = request;
  return request;
}

function scheduleAutosave(delay = AUTOSAVE_DELAY_MS) {
  clearAutosaveTimer();
  if (!state.editorDirty) return;
  scheduleRecoverySnapshot();
  if (!state.savedPost) {
    setAutosaveStatus('尚未儲存，已暫存於本機', 'local');
    return;
  }
  state.autosaveIntent += 1;
  const intent = state.autosaveIntent;
  setAutosaveStatus('等待自動儲存…', 'pending');
  state.autosaveTimer = window.setTimeout(() => {
    state.autosaveTimer = null;
    if (intent !== state.autosaveIntent || !state.editorDirty) return;
    saveDraft({ mode: 'autosave', intent }).catch(() => {});
  }, delay);
}
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
  const activeTarget = (state.savedPost?.targets || []).find((target) => target.id === state.activeTargetId || target.accountId === state.activeTargetId);
  const targetHint = activeTarget
    ? [selected.name || PLATFORM_NAMES[selected.id] || selected.id, targetStatusLabel(activeTarget.status)].join('：')
    : '';
  const publishHint = selected.canPublish ? targetHint : '目前僅預覽版型，尚未串接真發';
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
  const isSaving = Boolean(state.autosaveInFlight);
  const scheduleButton = $('#scheduleButton');
  const publishButton = $('#publishNowButton');
  if (scheduleButton) scheduleButton.disabled = !hasSavedPost || isDirty || isSaving;
  if (publishButton) {
    publishButton.disabled = !hasSavedPost || isDirty || isSaving || publishButton.dataset.busy === 'true';
  }
  const badge = $('#draftState');
  if (badge && hasSavedPost) {
    badge.textContent = isDirty ? '尚未儲存' : postStatusLabel(state.savedPost.status);
    badge.classList.toggle('ready', !isDirty && !isSaving);
  }
}

export function markEditorDirty(isDirty = true) {
  state.editorDirty = Boolean(isDirty);
  if (state.editorDirty) scheduleAutosave();
  else clearAutosaveTimer();
  syncEditorActions();
}
export function renderGenerated(generated, { syncSelectedMedia = false } = {}) {
  clearAutosaveTimer();
  if (state.autosaveRetryTimer) window.clearTimeout(state.autosaveRetryTimer);
  state.autosaveRetryTimer = null;
  state.autosaveIntent += 1;
  state.generated = generated;
  state.editorDirty = !state.savedPost;
  setAutosaveStatus(state.savedPost ? '已載入草稿' : '尚未儲存，編輯內容會暫存於本機', state.savedPost ? 'saved' : 'local');
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
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      clearAutosaveTimer();
      try {
        const saved = await saveDraft({ mode: 'manual' });
        if (!saved) return;
      } catch (error) {
        setPreviewMessage(error.message, 'error');
      }
    });
  }

  const retryButton = $('#autosaveRetryButton');
  retryButton?.addEventListener('click', async () => {
    clearAutosaveTimer();
    try {
      await saveDraft({ mode: 'manual' });
    } catch (error) {
      setPreviewMessage(error.message, 'error');
    }
  });
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
