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

export function showToast(message, type = 'info') {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3600);
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
