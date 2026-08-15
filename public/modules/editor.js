import { $, escapeHtml, isVideoPath, setPreviewMessage, showToast, fieldValue, setFieldValue, formatDate } from './dom.js';
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
    'clientId', 'contentStage', 'contentTopic', 'godName', 'postType', 'extraNotes', 'defaultHashtags',
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
  if (draft.contentStage === 'idea') return '';
  const type = fieldValue($('#targetContentType')) || draft.contentType || 'post';
  if (type === 'reel' && !String(draft.reel || '').trim()) return 'Reel 文案尚未完成。';
  if (type !== 'reel' && !String(draft.facebook || '').trim()) return '貼文文案尚未完成。';
  return '';
}

async function saveDraft({ mode = 'manual', intent = state.autosaveIntent } = {}) {
  if (state.savedPost?.status === 'archived') {
    setAutosaveStatus('封存中的貼文不可編輯，請先還原。', 'blocked');
    return null;
  }
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
  const payload = { ...draft, versionSource: mode };
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
const VERSION_SOURCE_LABELS = {
  created: '建立貼文',
  manual: '手動儲存',
  autosave: '自動儲存',
  schedule: '排程前',
  publish: '發布前',
  restore: '還原版本',
  archive: '封存',
  duplicate: '複製',
};

function renderVersionHistory(versions = []) {
  const list = $('#versionHistoryList');
  if (!list) return;
  if (!versions.length) {
    list.innerHTML = '<p class="version-history-empty">尚未建立版本歷史。</p>';
    return;
  }
  list.innerHTML = versions.map((version) => {
    const summary = version.summary || {};
    const platforms = Array.isArray(summary.platforms) && summary.platforms.length
      ? summary.platforms.join('、')
      : '尚未選擇平台';
    const source = VERSION_SOURCE_LABELS[version.source] || version.source || '內容變更';
    const archived = version.archived === true;
    return '<article class="version-history-item">'
      + '<div><strong>v' + escapeHtml(version.version || '?') + ' · ' + escapeHtml(source) + '</strong>'
      + '<small>' + escapeHtml(formatDate(version.createdAt)) + ' · ' + escapeHtml(platforms)
      + ' · ' + escapeHtml(String(summary.mediaCount || 0)) + ' 個素材</small></div>'
      + '<button class="btn-text" type="button" data-restore-version="' + escapeHtml(version.versionId) + '"'
      + (archived ? ' disabled' : '') + '>' + (archived ? '已封存' : '還原') + '</button>'
      + '</article>';
  }).join('');
}

export async function refreshVersionHistory() {
  const panel = $('#versionHistory');
  const list = $('#versionHistoryList');
  if (!panel || !list) return;
  if (!state.savedPost?.id) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  list.innerHTML = '<p class="version-history-empty">讀取版本歷史中…</p>';
  try {
    const result = await api('/api/posts/' + state.savedPost.id + '/versions');
    renderVersionHistory(result.versions || []);
  } catch (error) {
    list.innerHTML = '<p class="version-history-empty">版本歷史暫時無法載入：' + escapeHtml(error.message) + '</p>';
  }
}

async function createManualVersion() {
  if (!state.savedPost?.id) return;
  if (state.editorDirty) {
    setPreviewMessage('請先完成儲存，再建立版本。', 'error');
    return;
  }
  try {
    await api('/api/posts/' + state.savedPost.id + '/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'manual' }),
    });
    await refreshVersionHistory();
    showToast('版本已建立', 'success');
  } catch (error) {
    setPreviewMessage(error.message, 'error');
  }
}

async function restoreVersion(versionId) {
  if (!state.savedPost?.id || !versionId) return;
  if (!window.confirm('還原後會建立新的草稿版本，不會自動重新發布，是否繼續？')) return;
  try {
    const restored = await api('/api/posts/' + state.savedPost.id + '/versions/' + versionId + '/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: Number(state.savedPost.version || 1) }),
    });
    state.savedPost = restored;
    state.generated = restored;
    state.editorDirty = false;
    renderGenerated(restored);
    if (typeof refreshListsCallback === 'function') await refreshListsCallback();
    setPreviewMessage('版本已還原為新的草稿，請確認後再排程或發布。', 'success');
    showToast('版本已還原', 'success');
  } catch (error) {
    setPreviewMessage(error.message, 'error');
  }
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
  const storyNotice = $('#storyPreviewNotice');
  if (storyNotice) {
    const isStory = contentType === 'story';
    storyNotice.hidden = !isStory;
    storyNotice.textContent = isStory
      ? (state.selectedPlatform === 'facebook'
        ? 'Facebook Story 目前只能立即發布；發布後約 24 小時到期。'
        : 'Instagram Story 使用本機到點發布；發布後約 24 小時到期。')
      : '';
  }
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

function syncArchivedEditorState() {
  const locked = state.savedPost?.status === 'archived';
  document.querySelectorAll('#reviewPanel input, #reviewPanel textarea, #reviewPanel select').forEach((control) => {
    control.disabled = locked;
  });
  ['btnRewritePlatform', 'btnRestoreMotherCopy', 'createVersionButton', 'autosaveRetryButton'].forEach((id) => {
    const button = $('#' + id);
    if (button && locked) button.disabled = true;
  });
  const panel = $('#reviewPanel');
  if (panel) panel.classList.toggle('is-archived', locked);
}
function syncApprovalActions() {
  const post = state.savedPost;
  const approvalState = post?.approvalState || 'draft';
  const badge = document.getElementById('approvalStateBadge');
  const submit = document.getElementById('submitReviewButton');
  const approve = document.getElementById('approveButton');
  const changes = document.getElementById('requestChangesButton');
  const required = Boolean(currentClient()?.approvalRequired);
  if (badge) {
    const labels = { draft: '草稿待送審', in_review: '審核中', approved: '已核准', changes_requested: '待修改後重送' };
    badge.textContent = !post ? '尚未儲存' : (required ? '審核：' + (labels[approvalState] || approvalState) : '審核未啟用 · ' + (labels[approvalState] || approvalState));
    badge.dataset.state = approvalState;
  }
  if (submit) submit.classList.toggle('is-hidden', !post || ['in_review', 'approved'].includes(approvalState));
  if (approve) approve.classList.toggle('is-hidden', !post || approvalState !== 'in_review');
  if (changes) changes.classList.toggle('is-hidden', !post || approvalState !== 'in_review');
}

async function runApprovalAction(action) {
  const post = state.savedPost;
  if (!post?.id) return setPreviewMessage('請先儲存草稿，再操作審核。', 'error');
  if (state.editorDirty) {
    await saveDraft({ mode: 'manual' });
  }
  const note = action === 'request-changes' ? window.prompt('請輸入修改意見（可留白）：', '') : '';
  if (action === 'request-changes' && note === null) return;
  try {
    const updated = await api('/api/posts/' + encodeURIComponent(post.id) + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'request-changes' ? { note } : {}),
    });
    state.savedPost = updated;
    state.generated = updated;
    state.editorDirty = false;
    renderGenerated(updated);
    if (typeof refreshListsCallback === 'function') await refreshListsCallback();
    setPreviewMessage(action === 'approve' ? '內容已核准。' : action === 'submit-review' ? '內容已送出審核。' : '已要求修改。', 'success');
  } catch (error) {
    setPreviewMessage(error.message || '審核操作失敗。', 'error');
    showToast(error.message || '審核操作失敗。', 'error');
  }
}

function syncEditorActions() {
  const isArchived = state.savedPost?.status === 'archived';
  const isIdea = state.savedPost?.contentStage === 'idea';
  const hasSavedPost = Boolean(state.savedPost);
  const isDirty = Boolean(state.editorDirty);
  const isSaving = Boolean(state.autosaveInFlight);
  const scheduleButton = $('#scheduleButton');
  document.getElementById('submitReviewButton')?.addEventListener('click', () => runApprovalAction('submit-review'));
  document.getElementById('approveButton')?.addEventListener('click', () => runApprovalAction('approve'));
  document.getElementById('requestChangesButton')?.addEventListener('click', () => runApprovalAction('request-changes'));
  const publishButton = $('#publishNowButton');
  if (scheduleButton) scheduleButton.disabled = isArchived || isIdea || !hasSavedPost || isDirty || isSaving;
  if (publishButton) {
    publishButton.disabled = isArchived || isIdea || !hasSavedPost || isDirty || isSaving || publishButton.dataset.busy === 'true';
  }
  const badge = $('#draftState');
  if (badge && hasSavedPost) {
    badge.textContent = isIdea ? 'Idea' : isDirty ? '尚未儲存' : postStatusLabel(state.savedPost.status);
    badge.classList.toggle('ready', !isDirty && !isSaving);
  }
  syncArchivedEditorState();
  syncApprovalActions();
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
    badge.textContent = state.savedPost?.status === 'archived' ? '已封存' : '可編輯';
    badge.classList.add('ready');
  }
  const saveBtn = $('#saveButton');
  if (saveBtn) saveBtn.disabled = state.savedPost?.status === 'archived';
  const scheduleBtn = $('#scheduleButton');
  if (scheduleBtn) scheduleBtn.disabled = !state.savedPost || state.editorDirty;
  syncEditorActions();
  renderSavedMedia(mediaPathsOf(generated));
  renderPreviewPlatformTabs();
  updateLivePreview();
  if (state.savedPost?.id) refreshVersionHistory();
}

export function currentDraft() {
  const selectedServerPaths = state.selectedMediaItems.map((item) => item.serverPath).filter(Boolean);
  const mediaPaths = selectedServerPaths.length ? selectedServerPaths : mediaPathsOf(state.generated || {});
  const accounts = currentClient()?.accounts || state.accounts || [];
  const activeAccount = accounts.find((account) => account.id === state.activeTargetId)
    || accounts.find((account) => state.selectedTargetAccountIds.includes(account.id))
    || accounts.find((account) => account.platformId === 'facebook')
    || accounts[0]
    || null;
  const activeTarget = getActiveTarget();
  const activeCopy = fieldValue($('#targetContentType')) === 'reel'
    ? ($('#reelText')?.value || '')
    : ($('#facebookText')?.value || '');
  const motherFacebook = state.savedPost?.facebook || state.generated?.facebook || '';
  const motherReel = state.savedPost?.reel || state.generated?.reel || '';
  const activePlatform = activeAccount?.platformId || activeTarget?.platformId || 'facebook';
  const isMotherCopy = !activeTarget?.copyOverride;
  const contentTopic = $('#contentTopic')?.value || '';
  const draft = {
    ...(state.generated || {}),
    contentStage: state.savedPost?.contentStage || state.generated?.contentStage || 'draft',
    clientId: state.currentClientId || '',
    contentTopic,
    godName: contentTopic,
    postType: document.querySelector('input[name="postType"]:checked')?.value || 'intro',
    extraNotes: $('#extraNotes')?.value || '',
    defaultHashtags: $('#defaultHashtags')?.value || '',
    channel: activePlatform,
    accountId: state.activeTargetId || activeAccount?.id || '',
    contentType: fieldValue($('#createContentType')) || fieldValue($('#targetContentType')) || 'post',
    contentSettings: Object.keys(readTargetContentSettings()).length
      ? readTargetContentSettings()
      : readCreateContentSettings(),
    facebook: activePlatform === 'facebook' && isMotherCopy ? activeCopy : motherFacebook,
    reel: activePlatform === 'facebook' && isMotherCopy && fieldValue($('#targetContentType')) === 'reel' ? activeCopy : motherReel,
    hashtags: $('#hashtagsText')?.value ? $('#hashtagsText').value.split(/\s+/).map((tag) => tag.trim()).filter(Boolean) : [],
    imagePath: mediaPaths[0] || '',
    mediaPaths,
  };
  draft.targets = buildTargetsPayload(draft);
  return draft;
}
export function initEditorListeners(refreshListsFn) {
  refreshListsCallback = refreshListsFn;
  window.addEventListener('beforeunload', (event) => {
    if (!state.editorDirty && !state.autosaveInFlight) return;
    event.preventDefault();
    event.returnValue = '';
  });

  const refreshVersionsButton = $('#refreshVersionsButton');
  refreshVersionsButton?.addEventListener('click', () => refreshVersionHistory());
  const createVersionButton = $('#createVersionButton');
  createVersionButton?.addEventListener('click', () => createManualVersion());
  const versionList = $('#versionHistoryList');
  versionList?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-restore-version]');
    if (!button || button.disabled) return;
    restoreVersion(button.dataset.restoreVersion);
  });
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
            clientId: state.currentClientId,
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
