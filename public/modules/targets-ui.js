import { $, escapeHtml, fieldValue } from './dom.js';
import { state, currentClient } from './state.js';
import { platformName, platformPillFaceHtml } from './platform-icon.js';
import {
  renderTargetContentTypeControls,
  renderTargetContentSettings,
  readTargetContentSettings,
  updateTargetFormatDependentUi,
  resolveLockedContentType,
} from './platform-ui.js';

function accountScanExtra(account) {
  const platform = platformName(account.platformId);
  const bits = [];
  if (account.name && account.name !== platform) bits.push(account.name);
  else if (!account.configured) bits.push('未連線');
  return bits.map((bit) => escapeHtml(bit)).join(' · ');
}

function accountsForComposer(accounts = []) {
  const enabled = accounts.filter((account) => account.enabled !== false);
  const result = [];
  const seenPlatform = new Set();
  for (const account of enabled) {
    const siblings = enabled.filter((item) => item.platformId === account.platformId);
    const configured = siblings.filter((item) => item.configured);
    const visible = configured.length ? [configured[0]] : [siblings[0]];
    if (seenPlatform.has(account.platformId)) continue;
    seenPlatform.add(account.platformId);
    visible.forEach((item) => {
      if (!result.some((existing) => existing.id === item.id)) result.push(item);
    });
  }
  return result;
}

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

function motherCopyForTarget(post, target) {
  const copy = post && typeof post === 'object' ? post : {};
  if (target?.contentType === 'reel') return copy.reel || copy.facebook || '';
  return copy.facebook || '';
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

function renderFirstCommentField(target = null, account = null) {
  const field = $('#targetFirstCommentField');
  const input = $('#targetFirstComment');
  if (!field || !input) return;
  const supported = account?.platformId === 'instagram'
    && account?.capabilities?.first_comment?.status === 'supported';
  field.classList.toggle('is-hidden', !supported);
  const firstComment = target?.delivery?.firstComment || target?.firstComment || {};
  input.value = String(firstComment.text || '');
  input.disabled = firstComment.status === 'published';
  input.title = input.disabled ? '首則留言已發布；如需修改請另建立平台留言。' : '';
  const helper = $('#targetFirstCommentHint');
  if (helper) helper.textContent = input.disabled
    ? '首則留言已發布，重試只會使用已保存內容。'
    : '主貼文發布成功後才會送出；失敗可在發布紀錄單獨重試。';
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
  const accounts = accountsForComposer(client?.accounts || state.accounts || []);
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
      return '<label class="radio-pill radio-pill-platform">'
        + '<input type="checkbox" value="' + escapeHtml(account.id) + '"' + (checked ? ' checked' : '') + ' />'
        + platformPillFaceHtml(account.platformId, { extra: accountScanExtra(account) })
        + '</label>';
    }).join('')
    : '<p class="helper">此品牌尚未設定平台連線，請到設定新增。</p>';

  syncSelectedTargetAccountIds();
  const activeAccounts = accounts.filter((account) => state.selectedTargetAccountIds.includes(account.id));

  if (activeField) {
    activeField.classList.toggle('is-hidden', activeAccounts.length <= 1);
  }

  const post = state.savedPost || state.generated || {};
  const targets = Array.isArray(post.targets) ? post.targets : [];

  tabs.innerHTML = activeAccounts.map((account) => {
    const target = targets.find((item) => item.accountId === account.id || item.id === account.id);
    const overridden = target?.copyOverride != null && String(target.copyOverride).trim() !== '';
    const dot = '<span class="target-status-dot ' + (overridden ? 'is-overridden' : 'is-inherited') + '" title="' + (overridden ? '已客製覆寫此平台文案' : '沿用母稿') + '"></span>';
    return '<label class="radio-pill radio-pill-platform">'
    + '<input type="radio" name="activeTargetAccount" value="' + escapeHtml(account.id) + '"'
    + (account.id === state.activeTargetId ? ' checked' : '')
    + ' />'
    + platformPillFaceHtml(account.platformId, { extra: (dot + accountScanExtra(account)).trim() })
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
  renderFirstCommentField(target, account);
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
  return motherCopyForTarget(post, target || {});
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
      ? (draft.reel || state.savedPost?.reel || state.generated?.reel || '')
      : (draft.facebook || state.savedPost?.facebook || state.generated?.facebook || '');
    const copyOverride = currentCopy.trim() && currentCopy.trim() !== String(motherCopy || '').trim()
      ? currentCopy
      : null;
    const previousFirstComment = previous?.delivery?.firstComment || previous?.firstComment || {};
    const firstCommentText = isActive
      ? String($('#targetFirstComment')?.value || '').trim()
      : String(previousFirstComment.text || '').trim();
    const firstCommentStatus = firstCommentText
      ? (firstCommentText === String(previousFirstComment.text || '').trim()
        ? (previousFirstComment.status || 'pending')
        : 'pending')
      : 'disabled';
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
      delivery: {
        firstComment: {
          status: firstCommentStatus,
          text: firstCommentText,
          externalId: previousFirstComment.externalId || null,
          lastError: previousFirstComment.lastError || null,
          ...(previousFirstComment.publishedAt ? { publishedAt: previousFirstComment.publishedAt } : {}),
        },
      },
    };
  });
}

export function initTargetListeners({ onActiveTargetChange } = {}) {
  const checks = $('#targetAccountChecks');
  if (checks) {
    checks.addEventListener('change', (event) => {
      if (event.target && event.target.checked && event.target.value) {
        state.activeTargetId = event.target.value;
      }
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
