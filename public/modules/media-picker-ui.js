import { $, escapeHtml, isVideoPath, setFormMessage, bindDialogDismiss } from './dom.js';
import { api } from './api.js';
import { state, mediaPathsOf, clientQuery } from './state.js';
import { previewMediaSrc } from './media-preview.js';
import {
  MAX_MEDIA_ITEMS,
  collectPickerAssets,
  filterPickerAssets,
  mediaItemFromAsset,
  mergeSelectedMedia,
  pickerSelectionMessage,
  seedSelectedMedia,
} from './media-picker.js';
import { refreshSelectedMediaPreview } from './upload.js';

const picker = {
  query: '',
  type: 'all',
  assets: [],
  selected: new Set(),
};

function fileOnlyCount() {
  return state.selectedMediaItems.filter((item) => item.file && !item.serverPath).length;
}

function libraryCap() {
  return Math.max(0, MAX_MEDIA_ITEMS - fileOnlyCount());
}

function visibleAssets() {
  return filterPickerAssets(picker.assets, { query: picker.query, type: picker.type });
}

function renderPickerGrid() {
  const grid = $('#mediaPickerGrid');
  const summary = $('#mediaPickerSummary');
  if (!grid) return;
  const visible = visibleAssets();
  const cap = libraryCap();
  if (summary) {
    summary.textContent = picker.assets.length
      ? `可選 ${picker.selected.size}/${cap} · 顯示 ${visible.length} 個`
      : '還沒有可重用的素材。先上傳一次後就會出現在這裡。';
  }
  if (!visible.length) {
    grid.className = 'list-empty media-picker-empty';
    grid.innerHTML = picker.assets.length
      ? '<div class="empty-state"><span class="empty-icon">⌕</span><p>找不到符合條件的素材。</p></div>'
      : '<div class="empty-state"><span class="empty-icon">▧</span><p>還沒有素材可選。</p></div>';
    return;
  }
  grid.className = 'media-picker-grid';
  grid.innerHTML = visible.map((asset) => {
    const path = asset.mediaPath;
    const selected = picker.selected.has(path);
    const video = isVideoPath(path) || String(asset.mimeType || '').startsWith('video/');
    const name = escapeHtml(asset.originalName || path);
    const src = escapeHtml(previewMediaSrc(path));
    const preview = video
      ? '<video src="' + src + '" muted playsinline preload="metadata"></video>'
      : '<img src="' + src + '" alt="" loading="lazy" />';
    const disabled = !selected && picker.selected.size >= cap;
    return '<button type="button" class="media-picker-card" data-media-path="' + escapeHtml(path) + '" aria-pressed="' + String(selected) + '"'
      + (disabled ? ' disabled' : '')
      + ' aria-label="' + name + (selected ? '，已選取' : '') + '">'
      + '<span class="media-picker-preview" data-type="' + (video ? 'video' : 'image') + '">' + preview + '</span>'
      + '<strong>' + name + '</strong></button>';
  }).join('');
}

function syncPickerFiltersFromDom() {
  picker.query = $('#mediaPickerSearch')?.value.trim() || '';
  picker.type = document.querySelector('input[name="pickerMediaType"]:checked')?.value || 'all';
}

async function openMediaPicker() {
  const dialog = $('#mediaPickerDialog');
  if (!dialog) return;
  picker.query = '';
  picker.type = 'all';
  if ($('#mediaPickerSearch')) $('#mediaPickerSearch').value = '';
  const allType = document.querySelector('input[name="pickerMediaType"][value="all"]');
  if (allType) allType.checked = true;
  picker.selected = new Set(
    seedSelectedMedia(
      state.selectedMediaItems,
      mediaPathsOf(state.generated || state.savedPost || {}),
    ).map((item) => item.serverPath).filter(Boolean),
  );
  try {
    const payload = await api(clientQuery('/api/media'));
    picker.assets = collectPickerAssets({
      assets: payload.assets || [],
      posts: state.posts || [],
      clientId: state.currentClientId,
    });
  } catch (error) {
    picker.assets = collectPickerAssets({
      assets: [],
      posts: state.posts || [],
      clientId: state.currentClientId,
    });
    setFormMessage(error.message || '無法讀取素材庫。', 'error');
  }
  renderPickerGrid();
  if (typeof dialog.showModal === 'function') dialog.showModal();
}

function confirmMediaPicker(renderSavedMediaFn) {
  const selectedAssets = picker.assets.filter((asset) => picker.selected.has(asset.mediaPath));
  state.selectedMediaItems = seedSelectedMedia(
    state.selectedMediaItems,
    mediaPathsOf(state.generated || state.savedPost || {}),
  );
  const result = mergeSelectedMedia(state.selectedMediaItems, selectedAssets.map(mediaItemFromAsset));
  state.selectedMediaItems = result.items;
  state.editorDirty = Boolean(result.added);
  refreshSelectedMediaPreview(renderSavedMediaFn);
  setFormMessage(pickerSelectionMessage(result), result.added ? 'success' : '');
  $('#mediaPickerDialog')?.close();
}

export function initMediaPicker(renderSavedMediaFn) {
  const dialog = $('#mediaPickerDialog');
  bindDialogDismiss(dialog);
  dialog?.querySelector('form')?.addEventListener('submit', (event) => event.preventDefault());
  $('#pickLibraryMediaButton')?.addEventListener('click', () => {
    openMediaPicker();
  });
  $('#mediaPickerSearch')?.addEventListener('input', () => {
    syncPickerFiltersFromDom();
    renderPickerGrid();
  });
  document.querySelectorAll('input[name="pickerMediaType"]').forEach((input) => {
    input.addEventListener('change', () => {
      syncPickerFiltersFromDom();
      renderPickerGrid();
    });
  });
  $('#mediaPickerGrid')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-media-path]');
    if (!card || card.disabled) return;
    const path = card.dataset.mediaPath;
    if (picker.selected.has(path)) picker.selected.delete(path);
    else if (picker.selected.size < libraryCap()) picker.selected.add(path);
    renderPickerGrid();
  });
  $('#mediaPickerConfirm')?.addEventListener('click', () => confirmMediaPicker(renderSavedMediaFn));
  $('#mediaPickerCancel')?.addEventListener('click', () => dialog?.close());
}
