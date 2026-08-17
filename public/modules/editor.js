import { $, setPreviewMessage, setFormMessage, showToast, fieldValue, setFieldValue, bindDialogDismiss } from './dom.js';
import { state, DEFAULT_HASHTAGS, PLATFORM_NAMES, mediaPathsOf, currentClient, hasPermission } from './state.js';
import {
  renderCreatePublishSpec,
  renderCreateContentSettings,
  readCreateContentSettings,
  readTargetContentSettings,
} from './platform-ui.js';
import { clearUploadPreview } from './upload.js';
import { api, createIdempotencyKey } from './api.js';
import {
  buildTargetsPayload,
  getActiveTarget,
  getMotherCopyForActiveTarget,
  renderTargetAccountControls,
  applyActiveTargetToEditor,
} from './targets-ui.js';
import { postStatusLabel } from './status.js';

// Re-export autosave & snapshot utilities
export {
  AUTOSAVE_DELAY_MS,
  RECOVERY_SNAPSHOT_TTL_MS,
  RECOVERY_SNAPSHOT_LIMIT,
  RECOVERY_KEY_PREFIX,
  RECOVERY_INDEX_KEY,
  recoveryKey,
  setAutosaveStatus,
  clearAutosaveTimer,
  readRecoveryIndex,
  writeRecoverySnapshot,
  scheduleRecoverySnapshot,
  clearRecoverySnapshot,
  readRecoverySnapshot,
  saveDraft,
  scheduleAutosave,
  markEditorDirty,
} from './editor-autosave.js';

// Re-export version management utilities
export {
  VERSION_SOURCE_LABELS,
  renderVersionHistory,
  refreshVersionHistory,
  createManualVersion,
  restoreVersion,
} from './editor-versions.js';

// Re-export preview & character count utilities
export {
  updateCharacterCounts,
  updateLivePreview,
  renderPreviewPlatformTabs,
  renderSavedMedia,
  confirmImmediatePublish,
} from './editor-preview.js';

import {
  setAutosaveDependencies,
  clearAutosaveTimer,
  clearRecoverySnapshot,
  setAutosaveStatus,
  saveDraft,
  markEditorDirty,
} from './editor-autosave.js';

import {
  setVersionDependencies,
  refreshVersionHistory,
  createManualVersion,
  restoreVersion,
} from './editor-versions.js';

import {
  updateLivePreview,
  renderPreviewPlatformTabs,
  renderSavedMedia,
  confirmImmediatePublish,
} from './editor-preview.js';

let refreshListsCallback = null;

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
  const box = document.getElementById('approvalActions');
  const badge = document.getElementById('approvalStateBadge');
  const submit = document.getElementById('submitReviewButton');
  const approve = document.getElementById('approveButton');
  const changes = document.getElementById('requestChangesButton');
  const required = Boolean(currentClient()?.approvalRequired);
  if (box) {
    const show = required || ['in_review', 'changes_requested'].includes(approvalState);
    box.classList.toggle('is-hidden', !show);
  }
  if (badge) {
    const labels = { draft: '草稿待送審', in_review: '審核中', approved: '已核准', changes_requested: '待修改後重送' };
    badge.textContent = !post ? '尚未儲存' : (required ? '審核：' + (labels[approvalState] || approvalState) : '審核未啟用 · ' + (labels[approvalState] || approvalState));
    badge.dataset.state = approvalState;
  }
  if (submit) submit.classList.toggle('is-hidden', !post || ['in_review', 'approved'].includes(approvalState));
  if (approve) approve.classList.toggle('is-hidden', !post || approvalState !== 'in_review');
  if (changes) changes.classList.toggle('is-hidden', !post || approvalState !== 'in_review');
}

function renderEvergreenControls() {
  const post = state.savedPost;
  const config = post?.evergreen || {};
  const sourcePublished = Boolean(post?.targets?.some((target) => target.status === 'published'));
  const card = $('#evergreenCard');
  const enable = $('#evergreenEnableButton');
  const pause = $('#evergreenPauseButton');
  const disable = $('#evergreenDisableButton');
  const interval = $('#evergreenIntervalDays');
  const max = $('#evergreenMaxOccurrences');
  const status = $('#evergreenStatus');
  const active = Boolean(config.enabled);
  if (interval && config.intervalDays) interval.value = String(config.intervalDays);
  if (max && config.maxOccurrences) max.value = String(config.maxOccurrences);
  if (card) card.classList.toggle('is-hidden', !hasPermission('schedule.manage'));
  if (enable) enable.disabled = !post?.id || !sourcePublished || !hasPermission('schedule.manage');
  if (pause) {
    pause.disabled = !active || !hasPermission('schedule.manage');
    pause.textContent = config.paused ? '恢復' : '暫停';
  }
  if (disable) disable.disabled = !active || !hasPermission('schedule.manage');
  if (status) {
    if (!post?.id) status.textContent = '請先儲存內容。';
    else if (!sourcePublished) status.textContent = '需先有已發布 target 才能啟用 Evergreen。';
    else if (!active) status.textContent = '尚未啟用 Evergreen。';
    else {
      const stateText = config.paused ? '已暫停' : '運作中';
      const next = config.nextScheduledAt ? ` · 下一次 ${formatDate(config.nextScheduledAt)}` : '';
      status.textContent = `${stateText} · 每 ${config.intervalDays || 7} 天 · 已建立 ${config.occurrenceCount || 0}/${config.maxOccurrences || 12} 次${next}`;
    }
  }
}

async function evergreenAction(action) {
  const post = state.savedPost;
  if (!post?.id) return setPreviewMessage('請先儲存內容，再操作 Evergreen。', 'error');
  const interval = Number($('#evergreenIntervalDays')?.value || 7);
  const maxOccurrences = Number($('#evergreenMaxOccurrences')?.value || 12);
  const startValue = $('#evergreenStartAt')?.value || '';
  if (action === 'enable' && (!Number.isInteger(interval) || !Number.isInteger(maxOccurrences))) {
    return setPreviewMessage('請輸入有效的 Evergreen 間隔與次數上限。', 'error');
  }
  if (action === 'enable' && !window.confirm('啟用 Evergreen 後會建立下一篇本機排程，確定繼續嗎？')) return;
  if (action === 'disable' && !window.confirm('停用 Evergreen？已建立的本機排程不會自動取消。')) return;
  const endpoint = '/api/posts/' + encodeURIComponent(post.id) + '/evergreen';
  const options = { method: action === 'disable' ? 'DELETE' : action === 'pause' ? 'PATCH' : 'POST' };
  if (options.method !== 'DELETE') {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(action === 'enable'
      ? {
        clientId: state.currentClientId,
        intervalDays: interval,
        maxOccurrences,
        ...(startValue ? { startAt: new Date(startValue).toISOString() } : {}),
      }
      : { clientId: state.currentClientId, paused: !post.evergreen?.paused });
  }
  try {
    await api(endpoint, options);
    if (typeof refreshListsCallback === 'function') await refreshListsCallback();
    const refreshed = state.posts.find((entry) => entry.id === post.id);
    if (refreshed) {
      state.savedPost = refreshed;
      state.generated = refreshed;
      state.editorDirty = false;
      renderEvergreenControls();
    }
    setPreviewMessage(action === 'enable' ? 'Evergreen 已啟用並建立本機排程。' : action === 'pause' ? 'Evergreen 狀態已更新。' : 'Evergreen 已停用；既有本機排程仍保留。', 'success');
  } catch (error) {
    setPreviewMessage(error.message || 'Evergreen 操作失敗。', 'error');
  }
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

export function syncEditorActions() {
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
  renderEvergreenControls();
}

export function currentDraft() {
  const generated = state.generated || {};
  const contentType = fieldValue($('#createContentType')) || generated.contentType || 'post';
  const contentTopic = $('#contentTopic')?.value?.trim() || generated.contentTopic || generated.godName || '';
  const postType = document.querySelector('input[name="postType"]:checked')?.value || generated.postType || 'intro';
  const extraNotes = $('#extraNotes')?.value?.trim() || generated.extraNotes || '';
  const defaultHashtags = $('#defaultHashtags')?.value?.trim() || generated.defaultHashtags || '';
  const facebook = $('#facebookText')?.value || generated.facebook || '';
  const reel = $('#reelText')?.value || generated.reel || '';
  const hashtags = ($('#hashtagsText')?.value?.trim() || '')
    .split(/\s+/)
    .filter(Boolean);
  const selectedServerPaths = state.selectedMediaItems.map((item) => item.serverPath || item.source).filter(Boolean);
  const mediaPaths = state.selectedMediaItems.length
    ? selectedServerPaths
    : mediaPathsOf(generated);
  const imagePath = mediaPaths[0] || generated.imagePath || '';

  const draft = {
    ...generated,
    clientId: state.currentClientId || 'default',
    contentStage: state.savedPost?.contentStage || (generated.contentStage === 'idea' ? 'idea' : 'draft'),
    contentTopic,
    godName: contentTopic,
    postType,
    extraNotes,
    defaultHashtags,
    channel: state.selectedPlatform || 'facebook',
    accountId: state.activeTargetId || state.accounts?.[0]?.id || 'facebook:default',
    contentType,
    contentSettings: readCreateContentSettings('facebook', contentType),
    facebook,
    reel,
    hashtags,
    imagePath,
    mediaPaths,
  };
  draft.targets = buildTargetsPayload(draft);
  return draft;
}

export function startNewComposer() {
  const previousId = state.savedPost?.id || 'new';
  clearAutosaveTimer();
  if (state.autosaveRetryTimer) window.clearTimeout(state.autosaveRetryTimer);
  state.autosaveRetryTimer = null;
  state.autosaveIntent += 1;
  clearRecoverySnapshot(previousId);
  if (previousId !== 'new') clearRecoverySnapshot('new');

  state.savedPost = null;
  state.generated = null;
  state.editorDirty = false;
  state.selectedTargetAccountIds = [];
  state.activeTargetId = '';
  state.selectedPlatform = 'facebook';

  clearUploadPreview(renderSavedMedia);
  $('#generateForm')?.reset?.();

  const contentTopic = $('#contentTopic');
  if (contentTopic) contentTopic.value = '';
  const extraNotes = $('#extraNotes');
  if (extraNotes) extraNotes.value = '';
  const facebookText = $('#facebookText');
  if (facebookText) facebookText.value = '';
  const reelText = $('#reelText');
  if (reelText) reelText.value = '';
  const hashtagsText = $('#hashtagsText');
  if (hashtagsText) hashtagsText.value = DEFAULT_HASHTAGS.join(' ');
  const defaultHashtags = $('#defaultHashtags');
  if (defaultHashtags) defaultHashtags.value = DEFAULT_HASHTAGS.join(' ');
  const postTypeIntro = document.querySelector('input[name="postType"][value="intro"]');
  if (postTypeIntro) postTypeIntro.checked = true;
  const targetScheduledAt = $('#targetScheduledAt');
  if (targetScheduledAt) targetScheduledAt.value = '';
  const targetFirstComment = $('#targetFirstComment');
  if (targetFirstComment) targetFirstComment.value = '';
  const imageInput = $('#imageInput');
  if (imageInput) imageInput.value = '';

  const createType = $('#createContentType');
  const postTypeRadio = createType?.querySelector?.('input[type="radio"][value="post"]');
  if (postTypeRadio) postTypeRadio.checked = true;
  renderCreatePublishSpec();
  renderCreateContentSettings('facebook', 'post');
  renderTargetAccountControls();

  const badge = $('#draftState');
  if (badge) {
    badge.textContent = '尚未產生';
    badge.classList.remove('ready');
  }
  const versionHistory = $('#versionHistory');
  if (versionHistory) versionHistory.hidden = true;
  setAutosaveStatus('', 'idle');
  setFormMessage('');
  setPreviewMessage('');
  updateLivePreview();
  renderPreviewPlatformTabs();
  syncEditorActions();
  const saveBtn = $('#saveButton');
  if (saveBtn) saveBtn.disabled = true;
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
  const previewItems = state.selectedMediaItems.length
    ? state.selectedMediaItems
    : mediaPathsOf(generated);
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
  renderSavedMedia(previewItems);
  updateLivePreview();
  renderPreviewPlatformTabs();
  syncEditorActions();
  refreshVersionHistory();
}

export function initEditorListeners(refreshListsFn) {
  refreshListsCallback = refreshListsFn;
  setAutosaveDependencies({
    getDraft: currentDraft,
    syncActions: syncEditorActions,
    onRefreshLists: refreshListsFn,
  });
  setVersionDependencies({
    onRefreshLists: refreshListsFn,
    renderGenerated,
  });

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

  const topicChips = $('#topicChips');
  topicChips?.addEventListener('click', (event) => {
    const chip = event.target?.closest?.('.topic-chip');
    if (!chip) return;
    const topic = chip.dataset.topic;
    const input = $('#contentTopic');
    if (input && topic) {
      input.value = topic;
      input.focus();
      markEditorDirty();
    }
  });

  const copyBtn = $('#btnCopyPreviewText');
  copyBtn?.addEventListener('click', async () => {
    const contentType = fieldValue($('#targetContentType')) || 'post';
    const text = contentType === 'reel'
      ? ($('#reelText')?.value?.trim() || $('#facebookText')?.value?.trim() || '')
      : ($('#facebookText')?.value?.trim() || '');
    const hashtags = $('#hashtagsText')?.value?.trim() || '';
    const fullText = [text, hashtags].filter(Boolean).join('\n\n');
    if (!fullText) {
      showToast('目前沒有文案可複製', 'error');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = fullText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast('已複製貼文文案到剪貼簿 📋', 'success');
    } catch {
      showToast('複製失敗，請手動選取複製', 'error');
    }
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
    if (target?.matches?.('#hashtagsText')) {
      const defaults = $('#defaultHashtags');
      if (defaults) defaults.value = target.value;
    }
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
  $('#evergreenEnableButton')?.addEventListener('click', () => evergreenAction('enable'));
  $('#evergreenPauseButton')?.addEventListener('click', () => evergreenAction('pause'));
  $('#evergreenDisableButton')?.addEventListener('click', () => evergreenAction('disable'));
  bindDialogDismiss($('#publishConfirmDialog'));
  const publishButton = $('#publishNowButton');
  publishButton?.addEventListener('click', async () => {
    if (publishButton.dataset.busy === 'true') return;
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
    const account = (state.accounts || []).find((entry) => entry.id === target.accountId);
    const accountName = account?.name || target.accountName || '';
    const confirmed = await confirmImmediatePublish({ platformName, accountName });
    if (!confirmed) return;
    publishButton.dataset.busy = 'true';
    syncEditorActions();

    setPreviewMessage(`正在發布到 ${platformName}…`, 'info');
    try {
      await api('/api/publish/target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() },
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
