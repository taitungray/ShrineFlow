import { $, escapeHtml, setFormMessage } from './dom.js';
import { state } from './state.js';

export function clearUploadPreview(renderSavedMediaFn) {
  state.selectedMediaItems.forEach((item) => URL.revokeObjectURL(item.source));
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
  state.selectedMediaItems.forEach((item) => transfer.items.add(item.file));
  const input = $('#imageInput');
  if (input) input.files = transfer.files;
}

export function moveSelectedMedia(fromIndex, toIndex, renderSavedMediaFn) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= state.selectedMediaItems.length || toIndex >= state.selectedMediaItems.length) return;
  const [item] = state.selectedMediaItems.splice(fromIndex, 1);
  state.selectedMediaItems.splice(toIndex, 0, item);
  syncSelectedMediaFiles();
  renderUploadPreview();
  if (typeof renderSavedMediaFn === 'function') renderSavedMediaFn(state.selectedMediaItems);
  setFormMessage('已調整順序；第 1 張會作為主要圖片。', 'success');
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
    const media = document.createElement(item.file.type.startsWith('video/') ? 'video' : 'img');
    media.src = item.source;
    media.draggable = false;
    media.setAttribute('draggable', 'false');
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

function clearReorderHighlight(gallery) {
  gallery.querySelectorAll('.dragging, .drag-over').forEach((item) => item.classList.remove('dragging', 'drag-over'));
}

function mediaItemFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return el?.closest?.('.sortable-media-item') || null;
}

export function bindUploadReordering(renderSavedMediaFn) {
  const gallery = $('#uploadPreviewGallery');
  if (!gallery) return;
  const pointerDrag = { id: null, from: null, startX: 0, startY: 0, active: false };

  gallery.addEventListener('click', (event) => {
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
    if (event.target.closest('[data-media-move]')) return;
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
    if (event.target.closest('[data-media-move]')) {
      event.preventDefault();
      return;
    }
    const figure = event.target.closest('.sortable-media-item');
    if (!figure) return;
    event.preventDefault();
    event.stopPropagation();
  });
}

export function previewSelectedMedia(fileList, renderSavedMediaFn) {
  const files = [...(fileList || [])];
  if (!files.length) {
    clearUploadPreview(renderSavedMediaFn);
    return false;
  }
  if (files.length > 10) {
    $('#imageInput').value = '';
    clearUploadPreview(renderSavedMediaFn);
    setFormMessage('一次最多選擇 10 個檔案。', 'error');
    return false;
  }
  const unsupported = files.find((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'));
  if (unsupported) {
    $('#imageInput').value = '';
    clearUploadPreview(renderSavedMediaFn);
    setFormMessage('「' + unsupported.name + '」不是圖片或影片。', 'error');
    return false;
  }
  const oversized = files.find((file) => file.size > 20 * 1024 * 1024);
  if (oversized) {
    $('#imageInput').value = '';
    clearUploadPreview(renderSavedMediaFn);
    setFormMessage('「' + oversized.name + '」超過 20MB。', 'error');
    return false;
  }

  clearUploadPreview(renderSavedMediaFn);
  state.generated = null;
  state.editorDirty = true;
  state.selectedMediaItems = files.map((file) => {
    const source = URL.createObjectURL(file);
    state.uploadPreviewUrls.push(source);
    return { file, source, type: file.type, name: file.name };
  });
  renderUploadPreview();
  if (typeof renderSavedMediaFn === 'function') renderSavedMediaFn(state.selectedMediaItems);
  const uploadZone = $('#uploadZone');
  if (uploadZone) uploadZone.classList.add('has-media');
  state.savedPost = null;
  const draftBadge = $('#draftState');
  if (draftBadge) {
    draftBadge.textContent = '待產生';
    draftBadge.classList.remove('ready');
  }
  const saveBtn = $('#saveButton');
  if (saveBtn) saveBtn.disabled = true;
  const scheduleBtn = $('#scheduleButton');
  if (scheduleBtn) scheduleBtn.disabled = true;
  const publishBtn = $('#publishNowButton');
  if (publishBtn) publishBtn.disabled = true;
  const imageCount = files.filter((file) => file.type.startsWith('image/')).length;
  const videoCount = files.length - imageCount;
  setFormMessage('已選擇 ' + files.length + ' 個檔案（圖片 ' + imageCount + '、影片 ' + videoCount + '）。', 'success');
  return true;
}
