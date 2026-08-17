import { $, showToast, setPreviewMessage, fieldValue } from './dom.js';
import { state } from './state.js';
import { api } from './api.js';

export const AUTOSAVE_DELAY_MS = 800;
export const RECOVERY_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_SNAPSHOT_LIMIT = 20;
export const RECOVERY_KEY_PREFIX = 'shrineflow.autosave.snapshot.v1';
export const RECOVERY_INDEX_KEY = 'shrineflow.autosave.index.v1';

let refreshListsCallback = null;
let currentDraftGetter = null;
let editorActionsSyncer = null;

export function setAutosaveDependencies({ getDraft, syncActions, onRefreshLists } = {}) {
  if (typeof getDraft === 'function') currentDraftGetter = getDraft;
  if (typeof syncActions === 'function') editorActionsSyncer = syncActions;
  if (typeof onRefreshLists === 'function') refreshListsCallback = onRefreshLists;
}

export function recoveryKey(postId = state.savedPost?.id || 'new') {
  return `${RECOVERY_KEY_PREFIX}:${state.currentClientId || 'default'}:${postId}`;
}

export function setAutosaveStatus(message = '', status = 'idle') {
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

export function clearAutosaveTimer() {
  if (state.autosaveTimer) window.clearTimeout(state.autosaveTimer);
  state.autosaveTimer = null;
}

export function readRecoveryIndex() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECOVERY_INDEX_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.key && item.savedAt) : [];
  } catch {
    return [];
  }
}

export function writeRecoverySnapshot(draft = (currentDraftGetter ? currentDraftGetter() : null)) {
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

export function scheduleRecoverySnapshot() {
  if (state.autosaveRetryTimer) window.clearTimeout(state.autosaveRetryTimer);
  state.autosaveRetryTimer = window.setTimeout(() => {
    state.autosaveRetryTimer = null;
    writeRecoverySnapshot();
  }, 350);
}

export function clearRecoverySnapshot(postId = state.savedPost?.id || 'new') {
  const key = recoveryKey(postId);
  try {
    localStorage.removeItem(key);
    const index = readRecoveryIndex().filter((item) => item.key !== key);
    localStorage.setItem(RECOVERY_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Ignore storage quota and privacy-mode errors.
  }
}

export function readRecoverySnapshot(postId) {
  const key = recoveryKey(postId);
  try {
    const snapshot = JSON.parse(localStorage.getItem(key) || 'null');
    const savedAt = new Date(snapshot?.savedAt || '').getTime();
    if (!snapshot || !Number.isFinite(savedAt) || Date.now() - savedAt > RECOVERY_SNAPSHOT_TTL_MS) {
      clearRecoverySnapshot(postId);
      return null;
    }
    return snapshot.draft || null;
  } catch {
    return null;
  }
}

function draftValidationMessage(draft) {
  if (draft.contentStage === 'idea') return '';
  const type = fieldValue($('#targetContentType')) || draft.contentType || 'post';
  if (type === 'reel' && !String(draft.reel || '').trim()) return 'Reel 文案尚未完成。';
  if (type !== 'reel' && !String(draft.facebook || '').trim()) return '貼文文案尚未完成。';
  return '';
}

export async function saveDraft({ mode = 'manual', intent = state.autosaveIntent } = {}) {
  if (state.savedPost?.status === 'archived') {
    setAutosaveStatus('封存中的貼文不可編輯，請先還原。', 'blocked');
    return null;
  }
  if (state.autosavePromise) {
    await state.autosavePromise;
    if (mode === 'autosave' && !state.editorDirty) return state.savedPost;
  }

  const draft = currentDraftGetter ? currentDraftGetter() : null;
  if (!draft) return null;

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
  if (editorActionsSyncer) editorActionsSyncer();

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
      if (editorActionsSyncer) editorActionsSyncer();
      if (state.editorDirty && intent !== state.autosaveIntent && mode === 'autosave') scheduleAutosave(0);
    }
  })();
  state.autosavePromise = request;
  return request;
}

export function scheduleAutosave(delay = AUTOSAVE_DELAY_MS) {
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

export function markEditorDirty(isDirty = true) {
  state.editorDirty = Boolean(isDirty);
  if (state.editorDirty) scheduleAutosave();
  else clearAutosaveTimer();
  if (editorActionsSyncer) editorActionsSyncer();
}
