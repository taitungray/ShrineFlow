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

    // Escape: Close Composer and return to previous view
    if (event.key === 'Escape') {
      // Don't interfere with open dialogs
      if (document.querySelector('dialog[open]')) return;
      const composer = $('#composerPanel');
      if (composer && !composer.classList.contains('is-hidden')) {
        event.preventDefault();
        location.hash = '#/content';
      }
    }

    // Ctrl+Shift+P: Toggle Composer Edit/Preview mode
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'p' || event.key === 'P')) {
      const composer = $('#composerPanel');
      if (composer && !composer.classList.contains('is-hidden')) {
        event.preventDefault();
        const currentMode = composer.dataset.composerMode || 'edit';
        const nextMode = currentMode === 'edit' ? 'preview' : 'edit';
        const modeBtn = composer.querySelector(`.composer-mode-button[data-composer-mode="${nextMode}"]`);
        if (modeBtn) modeBtn.click();
      }
    }

    // Alt+1-5: Quick navigate to main sidebar views
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      const viewMap = { '1': '#/overview', '2': '#/content', '3': '#/calendar', '4': '#/media', '5': '#/settings' };
      if (viewMap[event.key]) {
        event.preventDefault();
        location.hash = viewMap[event.key];
      }
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
