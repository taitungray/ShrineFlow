import { $, escapeHtml, isVideoPath, fieldValue } from './dom.js';
import { state, PLATFORM_NAMES, currentClient } from './state.js';
import { previewMediaSrc } from './media-preview.js';
import { renderPlatformStrategy } from './platform-strategy.js';
import { targetStatusLabel } from './status.js';

export function updateCharacterCounts() {
  const fbText = $('#facebookText')?.value || '';
  const reelText = $('#reelText')?.value || '';
  const fbBadge = $('#facebookCharCount');
  const reelBadge = $('#reelCharCount');

  const fbLen = Array.from(fbText).length;
  const reelLen = Array.from(reelText).length;

  if (fbBadge) {
    let hint = `${fbLen} 字 (建議 120-250 字)`;
    let isWarning = false;
    let isError = false;

    if (state.selectedPlatform === 'threads') {
      hint = `${fbLen} / 500 字`;
      if (fbLen > 500) isWarning = true;
      if (fbLen > 10000) isError = true;
    } else if (state.selectedPlatform === 'instagram') {
      hint = `${fbLen} / 2200 字`;
      if (fbLen > 2000) isWarning = true;
      if (fbLen > 2200) isError = true;
    } else {
      hint = `${fbLen} 字 (建議 120-250 字)`;
      if (fbLen > 0 && (fbLen < 80 || fbLen > 350)) isWarning = true;
    }

    fbBadge.textContent = hint;
    fbBadge.classList.toggle('is-warning', isWarning && !isError);
    fbBadge.classList.toggle('is-error', isError);
  }

  if (reelBadge) {
    const hint = `${reelLen} 字 (Reel 建議 50-90 字)`;
    const isWarning = reelLen > 120;
    reelBadge.textContent = hint;
    reelBadge.classList.toggle('is-warning', isWarning);
  }
}

export function updateLivePreview() {
  updateCharacterCounts();
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

  const activeTarget = (state.savedPost?.targets || []).find((target) => target.id === state.activeTargetId || target.accountId === state.activeTargetId);
  const targetHint = activeTarget ? targetStatusLabel(activeTarget.status) : '';
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
    const source = previewMediaSrc(item.source || '');
    const safeSource = escapeHtml(source);
    const label = escapeHtml(item.name || ('媒體 ' + (index + 1)));
    const isVideo = item.type === 'video' || String(item.type).startsWith('video/') || isVideoPath(source);
    return isVideo
      ? '<figure class="media-item"><video src="' + safeSource + '" controls playsinline preload="metadata" aria-label="' + label + '"></video></figure>'
      : '<figure class="media-item"><img src="' + safeSource + '" alt="' + label + '" loading="lazy" /></figure>';
  }).join('');
  const wrap = $('#previewImageWrap');
  if (wrap) {
    const isEmpty = normalized.length === 0;
    wrap.classList.toggle('empty', isEmpty);
    wrap.hidden = isEmpty;
  }
}

export function confirmImmediatePublish({ platformName, accountName }) {
  const accountBit = accountName ? `（${accountName}）` : '';
  const text = `將立即發布到 ${platformName}${accountBit}。發布後無法從 ShrineFlow 收回。`;
  const dialog = $('#publishConfirmDialog');
  const summary = $('#publishConfirmSummary');
  if (!dialog || typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(text));
  }
  if (summary) summary.textContent = text;
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'confirm');
    };
    dialog.addEventListener('close', onClose);
    dialog.returnValue = 'cancel';
    dialog.showModal();
  });
}
