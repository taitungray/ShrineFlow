import { $ } from './dom.js';

export function initKeyboardShortcuts() {
  window.addEventListener('keydown', (event) => {
    // Ctrl+S / Cmd+S: Save Draft
    if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'S')) {
      const composer = $('#composerPanel');
      if (composer && !composer.classList.contains('is-hidden')) {
        event.preventDefault();
        const saveBtn = $('#saveButton');
        if (saveBtn && !saveBtn.disabled) {
          saveBtn.click();
        }
      }
    }

    // Ctrl+Enter / Cmd+Enter: Open Schedule or Trigger Primary Action in Composer
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      const composer = $('#composerPanel');
      if (composer && !composer.classList.contains('is-hidden')) {
        event.preventDefault();
        const scheduleBtn = $('#scheduleButton');
        if (scheduleBtn && !scheduleBtn.disabled) {
          scheduleBtn.click();
        }
      }
    }

    // Alt+N: New Content
    if (event.altKey && (event.key === 'n' || event.key === 'N')) {
      event.preventDefault();
      location.hash = '#/content/new';
    }

    // ?: Keyboard shortcuts dialog (when not typing in an input/textarea)
    if (event.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      const shortcutsDialog = $('#shortcutsDialog');
      if (shortcutsDialog && typeof shortcutsDialog.showModal === 'function') {
        shortcutsDialog.showModal();
      }
    }
  });
}
