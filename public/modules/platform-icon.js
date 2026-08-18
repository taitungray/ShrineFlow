import { escapeHtml } from './dom.js';
import { PLATFORM_NAMES } from './state.js';

const KNOWN = new Set(['facebook', 'instagram', 'threads']);

export function platformName(platformId) {
  return PLATFORM_NAMES[platformId] || platformId || '';
}

export function platformIconHtml(platformId) {
  const id = String(platformId || '');
  if (!KNOWN.has(id)) return '';
  return '<img class="platform-icon" data-platform="' + escapeHtml(id) + '" src="/icons/' + escapeHtml(id) + '.svg" alt="" width="20" height="20" />';
}

export function platformMarkHtml(platformId) {
  const id = String(platformId || '');
  if (!KNOWN.has(id)) return '';
  return '<img class="platform-mark" data-platform="' + escapeHtml(id) + '" src="/icons/' + escapeHtml(id) + '.svg" alt="" width="22" height="22" />';
}

export function platformChipHtml(platformId, extraClass = '') {
  const id = String(platformId || '');
  const name = platformName(id);
  if (!KNOWN.has(id)) return '';
  const classes = ['platform-chip', extraClass].filter(Boolean).join(' ');
  return '<img class="' + classes + '" data-platform="' + escapeHtml(id) + '" src="/icons/' + escapeHtml(id) + '.svg" alt="" width="18" height="18" aria-label="' + escapeHtml(name) + '" />';
}

export function platformPillFaceHtml(platformId, { count = '', extra = '' } = {}) {
  const id = String(platformId || '');
  const name = platformName(id);
  const hidden = name + (count ? ' ' + count : '');
  return '<span data-platform="' + escapeHtml(id) + '">'
    + platformIconHtml(id)
    + '<span class="visually-hidden">' + escapeHtml(hidden) + '</span>'
    + (count ? '<span class="platform-scan-count" aria-hidden="true">' + escapeHtml(String(count)) + '</span>' : '')
    + (extra ? '<span class="platform-pill-extra">' + extra + '</span>' : '')
    + '</span>';
}

export function platformPillHtml(platformId, { name, value, checked = false, count = '', extra = '', type = 'radio' } = {}) {
  const id = String(platformId || value || '');
  const inputName = escapeHtml(name || '');
  const inputValue = escapeHtml(value || id);
  const inputType = type === 'checkbox' ? 'checkbox' : 'radio';
  return '<label class="radio-pill radio-pill-platform">'
    + '<input type="' + inputType + '" name="' + inputName + '" value="' + inputValue + '"'
    + (checked ? ' checked' : '') + ' />'
    + platformPillFaceHtml(id, { count, extra })
    + '</label>';
}
