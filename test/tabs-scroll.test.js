import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissOpenDialogs, resetViewScroll, setActiveView } from '../public/modules/tabs.js';

function mockClassList(initial = []) {
  const names = new Set(initial);
  return {
    add(name) { names.add(name); },
    remove(name) { names.delete(name); },
    toggle(name, force) {
      const on = force === undefined ? !names.has(name) : Boolean(force);
      if (on) names.add(name);
      else names.delete(name);
      return on;
    },
    contains(name) { return names.has(name); },
  };
}

function mockPanel(view, hidden) {
  return {
    dataset: { viewPanel: view },
    classList: mockClassList(hidden ? ['is-hidden'] : []),
  };
}

test('resetViewScroll sends window and nested panes back to top', () => {
  const scrollCalls = [];
  const editorPane = { scrollTop: 480 };
  const previewPane = { scrollTop: 220 };
  const win = {
    scrollTo(...args) {
      scrollCalls.push(args);
    },
  };
  const doc = {
    documentElement: { scrollTop: 640 },
    body: { scrollTop: 640 },
    querySelectorAll(selector) {
      assert.equal(selector, '.composer-editor-pane, .composer-preview-pane, .review-preview');
      return [editorPane, previewPane];
    },
  };

  resetViewScroll({ window: win, document: doc });

  assert.deepEqual(scrollCalls, [[{ top: 0, left: 0, behavior: 'instant' }]]);
  assert.equal(doc.documentElement.scrollTop, 0);
  assert.equal(doc.body.scrollTop, 0);
  assert.equal(editorPane.scrollTop, 0);
  assert.equal(previewPane.scrollTop, 0);
});

test('dismissOpenDialogs closes an open schedule dialog when leaving a view', () => {
  const closed = [];
  const scheduleDialog = {
    id: 'scheduleDialog',
    close() { closed.push(this.id); },
  };
  const doc = {
    querySelectorAll(selector) {
      assert.equal(selector, 'dialog[open]');
      return [scheduleDialog];
    },
  };

  dismissOpenDialogs({ document: doc });

  assert.deepEqual(closed, ['scheduleDialog']);
});

test('setActiveView is a no-op when the same route is already painted', () => {
  const scrollCalls = [];
  const overview = mockPanel('overview', false);
  const drafts = mockPanel('drafts', true);
  const composer = mockPanel('composer', true);
  composer.dataset.composerMode = 'edit';
  const title = { textContent: '總覽' };
  const section = { textContent: 'OVERVIEW' };

  global.document = {
    title: 'ShrineFlow · 總覽',
    documentElement: { scrollTop: 320 },
    body: { scrollTop: 320, classList: mockClassList() },
    querySelector(selector) {
      if (selector === '#composerPanel') return composer;
      if (selector === '#pageSectionTag') return section;
      if (selector === '#currentPageTitle') return title;
      if (selector === '#appSidebar') return { classList: mockClassList() };
      if (selector === '#sidebarScrim') return { classList: mockClassList() };
      if (selector === '#mobileMenuToggle') return { setAttribute() {} };
      if (selector === '#mobileMoreToggle') return { setAttribute() {} };
      if (selector === '#mobileSidebarClose') return { setAttribute() {} };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-view-panel]') return [overview, drafts, composer];
      if (selector === '[data-view-target]') return [];
      if (selector === '.composer-mode-button') return [];
      if (selector === 'dialog[open]') return [];
      if (selector === '.composer-editor-pane, .composer-preview-pane, .review-preview') {
        return [{ scrollTop: 80 }];
      }
      return [];
    },
  };
  global.window = {
    location: { hash: '#/overview' },
    history: { pushState() {} },
    scrollTo(...args) { scrollCalls.push(args); },
  };

  setActiveView('overview', { syncHash: false, routePath: 'overview' });

  assert.equal(global.document.documentElement.scrollTop, 320, 'resume / back must not reset a page that is already showing');
  assert.deepEqual(scrollCalls, []);
  assert.equal(title.textContent, '總覽');
});
