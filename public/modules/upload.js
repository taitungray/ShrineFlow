import { $, isVideoPath, setFormMessage } from './dom.js';
import { api } from './api.js';
import { state, mediaPathsOf, clientQuery, currentClient } from './state.js';
import { previewMediaSrc } from './media-preview.js';
import {
  findReadyAssetByChecksum,
  mediaItemFromAsset,
  mergeSelectedMedia,
  seedSelectedMedia,
} from './media-picker.js';
import { markEditorDirty } from './editor.js';

async function hashFileSha256(file) {
  if (!file || typeof crypto === 'undefined' || !crypto.subtle?.digest) return '';
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadLibraryAssets() {
  try {
    const payload = await api(clientQuery('/api/media'));
    return Array.isArray(payload?.assets) ? payload.assets : [];
  } catch {
    return [];
  }
}

async function bindDuplicateUploads(items = []) {
  const pending = (Array.isArray(items) ? items : []).filter((item) => item.file && !item.serverPath);
  if (!pending.length) return { items, reused: 0 };
  const assets = await loadLibraryAssets();
  const clientId = currentClient()?.id || state.currentClientId || '';
  const seenPaths = new Set(items.map((item) => item.serverPath).filter(Boolean));
  let reused = 0;
  const next = [];
  for (const item of items) {
    if (!item.file || item.serverPath) {
      next.push(item);
      continue;
    }
    const asset = findReadyAssetByChecksum(assets, await hashFileSha256(item.file), clientId);
    if (!asset) {
      next.push(item);
      continue;
    }
    reused += 1;
    revokePreviewUrl(item.source);
    if (seenPaths.has(asset.mediaPath)) continue;
    seenPaths.add(asset.mediaPath);
    next.push({
      ...mediaItemFromAsset(asset),
      source: asset.mediaPath,
    });
  }
  return { items: next, reused };
}

function revokePreviewUrl(source) {
  if (String(source || '').startsWith('blob:')) URL.revokeObjectURL(source);
}

function selectedItemIsVideo(item = {}) {
  return Boolean(item.file?.type?.startsWith('video/')
    || String(item.type || '').startsWith('video/')
    || item.type === 'video'
    || isVideoPath(item.serverPath || item.source || item.name || ''));
}

export function clearUploadPreview(renderSavedMediaFn) {
  state.selectedMediaItems.forEach((item) => revokePreviewUrl(item.source));
  state.uploadPreviewUrls = [];
  state.selectedMediaItems = [];
  const gallery = $('#uploadPreviewGallery');
  if (gallery) gallery.innerHTML = '';
  const uploadZone = $('#uploadZone');
  if (uploadZone) uploadZone.classList.remove('has-media');
  if (typeof renderSavedMediaFn === 'function') renderSavedMediaFn([]);
}

export function syncSelectedMediaFiles() {
  const transfer = new DataTransfer();
  state.selectedMediaItems.forEach((item) => {
    if (item.file) transfer.items.add(item.file);
  });
  const input = $('#imageInput');
  if (input) input.files = transfer.files;
}

export function refreshSelectedMediaPreview(renderSavedMediaFn) {
  syncSelectedMediaFiles();
  renderUploadPreview();
  if (typeof renderSavedMediaFn === 'function') renderSavedMediaFn(state.selectedMediaItems);
  const uploadZone = $('#uploadZone');
  if (uploadZone) uploadZone.classList.toggle('has-media', state.selectedMediaItems.length > 0);
}

function syncGeneratedMediaFromSelection() {
  if (!state.generated) return;
  const mediaPaths = state.selectedMediaItems.map((item) => item.serverPath).filter(Boolean);
  state.generated.mediaPaths = mediaPaths;
  state.generated.imagePath = mediaPaths[0] || '';
}

export function moveSelectedMedia(fromIndex, toIndex, renderSavedMediaFn) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.selectedMediaItems.length || toIndex >= state.selectedMediaItems.length) return;
  const [item] = state.selectedMediaItems.splice(fromIndex, 1);
  state.selectedMediaItems.splice(toIndex, 0, item);
  syncGeneratedMediaFromSelection();
  refreshSelectedMediaPreview(renderSavedMediaFn);
  setFormMessage('已調整順序；第 1 張會作為主要圖片。', 'success');
}

export function removeSelectedMedia(index, renderSavedMediaFn) {
  if (!Number.isInteger(index) || index < 0 || index >= state.selectedMediaItems.length) return;
  const [removed] = state.selectedMediaItems.splice(index, 1);
  revokePreviewUrl(removed?.source);
  state.uploadPreviewUrls = state.uploadPreviewUrls.filter((url) => url !== removed?.source);
  syncGeneratedMediaFromSelection();
  refreshSelectedMediaPreview(renderSavedMediaFn);
  markEditorDirty(true);
  const remaining = state.selectedMediaItems.length;
  setFormMessage(
    remaining
      ? '已移除第 ' + (index + 1) + ' 張，還剩 ' + remaining + ' 個。第 1 張會作為主要圖片。'
      : '已移除該張素材。',
    'success',
  );
}

export function renderUploadPreview() {
  const gallery = $('#uploadPreviewGallery');
  if (!gallery) return;
  gallery.innerHTML = '';
  state.selectedMediaItems.forEach((item, index) => {
    const figure = document.createElement('figure');
    figure.className = 'media-item sortable-media-item';
    figure.draggable = false;
    figure.dataset.index = String(index);
    figure.title = '拖曳調整順序';
    const video = selectedItemIsVideo(item);
    const media = document.createElement(video ? 'video' : 'img');
    media.src = previewMediaSrc(item.source || item.serverPath || '');
    media.draggable = false;
    media.setAttribute('draggable', 'false');
    media.setAttribute('aria-label', '已選媒體 ' + (index + 1));
    if (media.tagName === 'VIDEO') {
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
    } else {
      media.alt = item.name || item.file?.name || ('媒體 ' + (index + 1));
    }
    const badge = document.createElement('span');
    badge.className = 'media-order-badge';
    badge.textContent = String(index + 1);
    const controls = document.createElement('span');
    controls.className = 'media-order-controls';
    controls.innerHTML = '<button type="button" data-media-move="up" aria-label="上移"' + (index === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" data-media-move="down" aria-label="下移"' + (index === state.selectedMediaItems.length - 1 ? ' disabled' : '') + '>↓</button>';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'media-remove-button';
    removeButton.dataset.mediaRemove = 'true';
    removeButton.setAttribute('aria-label', '移除第 ' + (index + 1) + ' 張');
    removeButton.title = '移除這張';
    removeButton.textContent = '×';
    figure.append(media, badge, removeButton, controls);
    gallery.append(figure);
  });
}

function clearReorderHighlight(gallery) {
  gallery.querySelectorAll('.dragging, .drag-over').forEach((item) => item.classList.remove('dragging', 'drag-over'));
}

function mediaItemFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return el?.closest?.('.sortable-media-item') || null;
}

function isMediaActionTarget(event) {
  return Boolean(event.target.closest('[data-media-move], [data-media-remove]'));
}

export function bindUploadReordering(renderSavedMediaFn) {
  const gallery = $('#uploadPreviewGallery');
  if (!gallery) return;
  const pointerDrag = { id: null, from: null, startX: 0, startY: 0, active: false };

  gallery.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-media-remove]');
    if (removeButton) {
      event.preventDefault();
      event.stopPropagation();
      const figure = removeButton.closest('.sortable-media-item');
      removeSelectedMedia(Number(figure?.dataset.index), renderSavedMediaFn);
      return;
    }
    const button = event.target.closest('[data-media-move]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const figure = button.closest('.sortable-media-item');
    const index = Number(figure?.dataset.index);
    const offset = button.dataset.mediaMove === 'up' ? -1 : 1;
    moveSelectedMedia(index, index + offset, renderSavedMediaFn);
  });

  gallery.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (isMediaActionTarget(event)) return;
    const figure = event.target.closest('.sortable-media-item');
    if (!figure) return;
    pointerDrag.id = event.pointerId;
    pointerDrag.from = Number(figure.dataset.index);
    pointerDrag.startX = event.clientX;
    pointerDrag.startY = event.clientY;
    pointerDrag.active = false;
  });

  gallery.addEventListener('pointermove', (event) => {
    if (pointerDrag.id !== event.pointerId || pointerDrag.from === null) return;
    const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
    if (!pointerDrag.active && distance < 8) return;
    if (!pointerDrag.active) {
      pointerDrag.active = true;
      state.mediaDragIndex = pointerDrag.from;
      const source = gallery.querySelector('[data-index="' + pointerDrag.from + '"]');
      source?.classList.add('dragging');
      source?.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    gallery.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));
    const over = mediaItemFromPoint(event.clientX, event.clientY);
    if (over && Number(over.dataset.index) !== pointerDrag.from) over.classList.add('drag-over');
  });

  const endPointerDrag = (event) => {
    if (pointerDrag.id !== event.pointerId) return;
    const from = pointerDrag.from;
    const wasActive = pointerDrag.active;
    const over = wasActive ? mediaItemFromPoint(event.clientX, event.clientY) : null;
    clearReorderHighlight(gallery);
    pointerDrag.id = null;
    pointerDrag.from = null;
    pointerDrag.active = false;
    state.mediaDragIndex = null;
    if (!wasActive || from === null) return;
    const to = over ? Number(over.dataset.index) : from;
    moveSelectedMedia(from, to, renderSavedMediaFn);
  };

  gallery.addEventListener('pointerup', endPointerDrag);
  gallery.addEventListener('pointercancel', endPointerDrag);

  gallery.addEventListener('dragstart', (event) => {
    if (isMediaActionTarget(event)) {
      event.preventDefault();
      return;
    }
    const figure = event.target.closest('.sortable-media-item');
    if (!figure) return;
    event.preventDefault();
    event.stopPropagation();
  });
}

export async function previewSelectedMedia(fileList, renderSavedMediaFn) {
  const files = [...(fileList || [])];
  if (!files.length) return false;
  const unsupported = files.find((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'));
  if (unsupported) {
    syncSelectedMediaFiles();
    setFormMessage('「' + unsupported.name + '」不是圖片或影片。', 'error');
    return false;
  }
  const oversized = files.find((file) => file.size > 20 * 1024 * 1024);
  if (oversized) {
    syncSelectedMediaFiles();
    setFormMessage('「' + oversized.name + '」超過 20MB。', 'error');
    return false;
  }

  state.selectedMediaItems = seedSelectedMedia(
    state.selectedMediaItems,
    mediaPathsOf(state.generated || state.savedPost || {}),
  );
  const incoming = files.map((file) => ({
    kind: 'file',
    file,
    source: '',
    type: file.type,
    name: file.name,
  }));
  const result = mergeSelectedMedia(state.selectedMediaItems, incoming);
  result.items.forEach((item) => {
    if (item.file && !item.source) {
      item.source = URL.createObjectURL(item.file);
      state.uploadPreviewUrls.push(item.source);
    }
  });
  const bound = await bindDuplicateUploads(result.items);
  state.selectedMediaItems = bound.items;
  state.editorDirty = true;
  refreshSelectedMediaPreview(renderSavedMediaFn);
  const saveBtn = $('#saveButton');
  if (saveBtn && result.added) saveBtn.disabled = true;
  const scheduleBtn = $('#scheduleButton');
  if (scheduleBtn && result.added) scheduleBtn.disabled = true;
  const publishBtn = $('#publishNowButton');
  if (publishBtn && result.added) publishBtn.disabled = true;
  if (!result.added && result.skippedLimit) {
    setFormMessage('已達 10 個上限，沒有加入新檔案。', 'error');
    return false;
  }
  const stillUploading = bound.items.some((item) => item.file && !item.serverPath);
  if (bound.reused && !stillUploading) {
    setFormMessage('素材庫已有相同檔案，已改用既有素材，沒有再存一份。', 'success');
    return true;
  }
  const imageCount = files.filter((file) => file.type.startsWith('image/')).length;
  const videoCount = files.length - imageCount;
  const reusedNote = bound.reused ? '；其中 ' + bound.reused + ' 個與素材庫重複，已改用既有檔' : '';
  setFormMessage('已選擇 ' + files.length + ' 個檔案（圖片 ' + imageCount + '、影片 ' + videoCount + '）' + reusedNote + '。', 'success');
  return true;
}
