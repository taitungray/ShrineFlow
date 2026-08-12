import { $$, $ } from './dom.js';

export function setActiveView(view) {
  $$('[data-view-panel]').forEach((panel) => {
    panel.classList.toggle('is-hidden', panel.dataset.viewPanel !== view);
  });
  $$('[data-view-target]').forEach((tab) => {
    const isActive = tab.dataset.viewTarget === view;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
}

export function initTabs() {
  $$('[data-view-target]').forEach((tab) => {
    tab.addEventListener('click', () => setActiveView(tab.dataset.viewTarget));
  });
}
