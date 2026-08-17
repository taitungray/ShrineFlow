import { $, escapeHtml, setPreviewMessage, showToast, formatDate } from './dom.js';
import { state } from './state.js';
import { api } from './api.js';

export const VERSION_SOURCE_LABELS = {
  created: '建立貼文',
  manual: '手動儲存',
  autosave: '自動儲存',
  schedule: '排程前',
  publish: '發布前',
  restore: '還原版本',
  archive: '封存',
  duplicate: '複製',
};

let refreshListsCallback = null;
let generatedRenderer = null;

export function setVersionDependencies({ onRefreshLists, renderGenerated } = {}) {
  if (typeof onRefreshLists === 'function') refreshListsCallback = onRefreshLists;
  if (typeof renderGenerated === 'function') generatedRenderer = renderGenerated;
}

export function renderVersionHistory(versions = []) {
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

export async function createManualVersion() {
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

export async function restoreVersion(versionId) {
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
    if (generatedRenderer) generatedRenderer(restored);
    if (typeof refreshListsCallback === 'function') await refreshListsCallback();
    setPreviewMessage('版本已還原為新的草稿，請確認後再排程或發布。', 'success');
    showToast('版本已還原', 'success');
  } catch (error) {
    setPreviewMessage(error.message, 'error');
  }
}
