import { humanizePlatformError } from './platform-errors.js';

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);

export function escapeHtml(value = '') {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
  return String(value).replace(/[&<>'"]/g, (character) => entities[character]);
}

export function fieldValue(el) {
  if (!el) return '';
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLInputElement) return el.value;
  const checked = el.querySelector?.('input[type="radio"]:checked');
  return checked ? checked.value : '';
}

export function setFieldValue(el, value) {
  if (!el) return;
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.value = value;
    return;
  }
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/"/g, '\\"');
  const radio = el.querySelector?.('input[type="radio"][value="' + escaped + '"]');
  if (radio && !radio.disabled) radio.checked = true;
}

export function bindDialogDismiss(dialog) {
  if (!dialog) return;
  dialog.querySelectorAll('.close-button').forEach((button) => {
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
    });
  });
}

function closeToastPopover(toast) {
  if (typeof toast.hidePopover !== 'function') return;
  if (!toast.matches(':popover-open')) return;
  try { toast.hidePopover(); } catch {}
}

function openToastPopover(toast) {
  if (typeof toast.showPopover !== 'function') return;
  if (toast.matches(':popover-open')) return;
  try { toast.showPopover(); } catch {}
}

function attachToastToOpenDialog(toast) {
  const host = document.querySelector('dialog[open]') || document.body;
  if (toast.parentElement !== host) host.append(toast);
}

function restoreToastToBody(toast) {
  if (toast.parentElement !== document.body) document.body.append(toast);
}

export function hideToast() {
  const toast = $('#toast');
  if (!toast) return;
  toast.classList.remove('show');
  closeToastPopover(toast);
  restoreToastToBody(toast);
  window.clearTimeout(showToast.timer);
}

export function showToast(message, type = 'info') {
  const toast = $('#toast');
  if (!toast) return;
  const text = humanizePlatformError(message) || String(message || '');
  toast.replaceChildren();
  const body = document.createElement('span');
  body.className = 'toast-message';
  body.textContent = text;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', '關閉通知');
  close.textContent = '×';
  close.addEventListener('click', hideToast);
  toast.append(body, close);
  toast.dataset.type = type;
  attachToastToOpenDialog(toast);
  toast.classList.add('show');
  openToastPopover(toast);
  window.clearTimeout(showToast.timer);
  if (type !== 'error') {
    showToast.timer = window.setTimeout(hideToast, 3600);
  }
}

export function setFormMessage(message, type = '') {
  const element = $('#formMessage');
  if (!element) return;
  element.textContent = message;
  element.dataset.type = type;
}

export function setPreviewMessage(message, type = '') {
  const element = $('#previewMessage');
  if (!element) return;
  element.textContent = message;
  element.dataset.type = type;
}

export function isVideoPath(value = '') {
  return /\.(mp4|m4v|mov|mpeg|mpg|webm|ogv|avi)(?:[?#]|$)/i.test(value);
}

export function formatDate(value) {
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
