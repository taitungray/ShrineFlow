import { $, escapeHtml, fieldValue } from './dom.js';
import { state, currentClient, PLATFORM_NAMES } from './state.js';
import {
  renderTargetContentTypeControls,
  renderTargetContentSettings,
  readTargetContentSettings,
  updateTargetFormatDependentUi,
  resolveLockedContentType,
} from './platform-ui.js';

function motherContentType() {
  return fieldValue($('#createContentType')) || 'post';
}

function selectedAccountIds() {
  return [...document.querySelectorAll('#targetAccountChecks input[type="checkbox"]:checked')]
    .map((input) => input.value);
}

function accountById(accountId) {
  const client = currentClient();
  const accounts = client?.accounts || state.accounts || [];
  return accounts.find((account) => account.id === accountId) || null;
}

function motherCopyForTarget(post, target = {}) {
  if (target.contentType === 'reel') return post.reel || post.facebook || '';
  return post.facebook || '';
}

function renderCopyMode(target = null) {
  const mode = $('#platformCopyMode');
  const restore = $('#btnRestoreMotherCopy');
  const overridden = target?.copyOverride != null && String(target.copyOverride).trim() !== '';
  if (mode) {
    mode.textContent = overridden ? '已覆寫此平台文案' : '沿用母稿';
    mode.dataset.mode = overridden ? 'overridden' : 'inherited';
  }
  if (restore) restore.disabled = !overridden;
}

export function syncSelectedTargetAccountIds() {
  state.selectedTargetAccountIds = selectedAccountIds();
  if (!state.selectedTargetAccountIds.includes(state.activeTargetId)) {
    state.activeTargetId = state.selectedTargetAccountIds[0] || '';
  }
}

export function syncPreviewPlatformFromActiveTarget() {
  const account = accountById(state.activeTargetId);
  if (account?.platformId) state.selectedPlatform = account.platformId;
}

export function renderTargetAccountControls() {
  const checks = $('#targetAccountChecks');
  const tabs = $('#activeTargetTabs');
  const activeField = $('#activeTargetField');
  const client = currentClient();
  const accounts = client?.accounts || state.accounts || [];
  if (!checks || !tabs) return;

  if (!state.selectedTargetAccountIds.length) {
    const preferred = state.activeTargetId
      || accounts.find((account) => account.platformId === 'facebook' && account.configured)?.id
      || accounts.find((account) => account.platformId === 'facebook')?.id
      || accounts[0]?.id
      || '';
    if (preferred) state.selectedTargetAccountIds = [preferred];
  }

  checks.innerHTML = accounts.length
    ? accounts.map((account) => {
      const checked = state.selectedTargetAccountIds.includes(account.id);
      const platform = PLATFORM_NAMES[account.platformId] || account.platformId;
      return '<label class="radio-pill">'
        + '<input type="checkbox" value="' + escapeHtml(account.id) + '"' + (checked ? ' checked' : '') + ' />'
        + '<span>' + escapeHtml(platform)
        + (account.configured ? '' : '（未連線）') + '</span>'
        + '</label>';
    }).join('')
    : '<p class="helper">此品牌尚未設定平台連線，請到設定新增。</p>';

  syncSelectedTargetAccountIds();
  const activeAccounts = accounts.filter((account) => state.selectedTargetAccountIds.includes(account.id));

  if (activeField) {
    activeField.classList.toggle('is-hidden', activeAccounts.length <= 1);
  }

  tabs.innerHTML = activeAccounts.map((account) => {
    const platform = PLATFORM_NAMES[account.platformId] || account.name || account.platformId;
    return '<label class="radio-pill">'
    + '<input type="radio" name="activeTargetAccount" value="' + escapeHtml(account.id) + '"'
    + (account.id === state.activeTargetId ? ' checked' : '')
    + ' />'
    + '<span>' + escapeHtml(platform) + '</span>'
    + '</label>';
  }).join('');

  if (!state.activeTargetId && activeAccounts[0]) state.activeTargetId = activeAccounts[0].id;
  syncPreviewPlatformFromActiveTarget();
  applyActiveTargetToEditor();
}

export function applyActiveTargetToEditor() {
  const post = state.savedPost || state.generated || {};
  const targets = Array.isArray(post.targets) ? post.targets : [];
  const target = targets.find((item) => item.accountId === state.activeTargetId)
    || targets.find((item) => item.id === state.activeTargetId);
  const account = accountById(state.activeTargetId);
  const fb = $('#facebookText');
  const reel = $('#reelText');
  const scheduled = $('#targetScheduledAt');
  if (fb) {
    if (target?.contentType !== 'reel' && target?.copyOverride != null && String(target.copyOverride).trim() !== '') {
      fb.value = target.copyOverride;
    } else {
      fb.value = post.facebook || fb.value || '';
    }
  }
  if (reel) {
    if (target?.contentType === 'reel' && target?.copyOverride != null && String(target.copyOverride).trim() !== '') {
      reel.value = target.copyOverride;
    } else {
      reel.value = post.reel || reel.value || '';
    }
  }
  renderCopyMode(target);
  if (scheduled) {
    if (target?.scheduledAt) {
      const date = new Date(target.scheduledAt);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      scheduled.value = local.toISOString().slice(0, 16);
    } else {
      scheduled.value = '';
    }
  }

  renderTargetContentTypeControls({
    platformId: account?.platformId || target?.platformId || 'facebook',
    motherType: motherContentType(),
    selectedType: target?.contentType || null,
    contentSettings: target?.contentSettings || null,
  });
  syncPreviewPlatformFromActiveTarget();
}

export function getActiveTarget() {
  const post = state.savedPost || state.generated || {};
  const targets = Array.isArray(post.targets) ? post.targets : [];
  return targets.find((item) => item.accountId === state.activeTargetId)
    || targets.find((item) => item.id === state.activeTargetId)
    || null;
}

export function getMotherCopyForActiveTarget(target = getActiveTarget()) {
  const post = state.savedPost || state.generated || {};
  return motherCopyForTarget(post, target);
}

export function buildTargetsPayload(draft) {
  const client = currentClient();
  const accounts = client?.accounts || state.accounts || [];
  const existing = Array.isArray((state.savedPost || state.generated || {}).targets)
    ? (state.savedPost || state.generated).targets
    : [];
  const selectedIds = state.selectedTargetAccountIds.length
    ? state.selectedTargetAccountIds
    : [draft.accountId].filter(Boolean);

  return selectedIds.map((accountId) => {
    const account = accounts.find((item) => item.id === accountId);
    const previous = existing.find((item) => item.accountId === accountId);
    const isActive = accountId === state.activeTargetId;
    const scheduledAtRaw = isActive ? ($('#targetScheduledAt')?.value || '') : (previous?.scheduledAt || '');
    const scheduledAt = scheduledAtRaw
      ? (Number.isNaN(new Date(scheduledAtRaw).getTime()) ? previous?.scheduledAt || null : new Date(scheduledAtRaw).toISOString())
      : null;
    const platformId = account?.platformId || previous?.platformId || draft.channel || 'facebook';
    const defaultType = resolveLockedContentType(platformId, motherContentType())
      || motherContentType()
      || draft.contentType
      || 'post';
    const contentType = isActive
      ? (fieldValue($('#targetContentType')) || defaultType)
      : (previous?.contentType || defaultType);
    const activeContentSettings = Object.keys(readTargetContentSettings()).length
      ? readTargetContentSettings()
      : (draft.contentSettings || {});
    const currentCopy = contentType === 'reel' ? ($('#reelText')?.value || '') : ($('#facebookText')?.value || '');
    const motherCopy = contentType === 'reel'
      ? (state.savedPost?.reel || state.generated?.reel || draft.reel || '')
      : (state.savedPost?.facebook || state.generated?.facebook || draft.facebook || '');
    const copyOverride = currentCopy.trim() && currentCopy.trim() !== String(motherCopy || '').trim()
      ? currentCopy
      : null;
    return {
      id: previous?.id,
      accountId,
      platformId,
      contentType,
      contentSettings: isActive ? activeContentSettings : (previous?.contentSettings || {}),
      copyOverride: isActive
        ? copyOverride
        : (previous?.copyOverride ?? null),
      mediaPaths: previous?.mediaPaths ?? null,
      scheduledAt,
      status: scheduledAt
        ? (previous?.status === 'published' ? previous.status : 'scheduled')
        : (previous?.status === 'published' ? previous.status : 'draft'),
      externalId: previous?.externalId || null,
      publishedAt: previous?.publishedAt || null,
      lastError: previous?.lastError || null,
    };
  });
}

export function initTargetListeners({ onActiveTargetChange } = {}) {
  const checks = $('#targetAccountChecks');
  if (checks) {
    checks.addEventListener('change', () => {
      syncSelectedTargetAccountIds();
      renderTargetAccountControls();
      if (typeof onActiveTargetChange === 'function') onActiveTargetChange();
    });
  }
  const tabs = $('#activeTargetTabs');
  if (tabs) {
    tabs.addEventListener('change', (event) => {
      if (event.target?.name !== 'activeTargetAccount') return;
      state.activeTargetId = event.target.value;
      applyActiveTargetToEditor();
      if (typeof onActiveTargetChange === 'function') onActiveTargetChange();
    });
  }
  const contentType = $('#targetContentType');
  if (contentType) {
    contentType.addEventListener('change', () => {
      const account = accountById(state.activeTargetId);
      const platformId = account?.platformId || 'facebook';
      const selected = fieldValue($('#targetContentType')) || 'post';
      renderTargetContentSettings(platformId, selected);
      updateTargetFormatDependentUi(selected, platformId);
      if (typeof onActiveTargetChange === 'function') onActiveTargetChange();
    });
  }
}
