import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SIGNED_IN_KEY,
  THEME_KEY,
  rememberSignedIn,
  applyPinnedTheme,
  endBooting,
  initResumeStability,
} from '../public/modules/boot-stability.js';

function installStorage() {
  const memory = new Map();
  global.localStorage = {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(String(key), String(value));
    },
    removeItem(key) {
      memory.delete(key);
    },
  };
  return memory;
}

function mockDocument(visibilityState = 'visible') {
  const classNames = new Set();
  const listeners = {};
  const root = {
    classList: {
      add(name) { classNames.add(name); },
      remove(name) { classNames.delete(name); },
      contains(name) { return classNames.has(name); },
    },
    dataset: {},
  };
  return {
    visibilityState,
    documentElement: root,
    classNames,
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    emit(name, nextState) {
      this.visibilityState = nextState;
      listeners[name]?.();
    },
  };
}

test('rememberSignedIn writes a first-paint hint without storing the session secret', () => {
  const memory = installStorage();
  rememberSignedIn(true);
  assert.equal(memory.get(SIGNED_IN_KEY), '1');
  rememberSignedIn(false);
  assert.equal(memory.has(SIGNED_IN_KEY), false);
});

test('applyPinnedTheme prefers the stored scheme so iOS media-query flips cannot unpaint the page', () => {
  installStorage();
  const doc = mockDocument();
  localStorage.setItem(THEME_KEY, 'dark');
  applyPinnedTheme({
    document: doc,
    matchMedia: () => ({ matches: false }),
  });
  assert.equal(doc.documentElement.dataset.theme, 'dark');
});

test('initResumeStability freezes motion when the document becomes visible again', () => {
  installStorage();
  const doc = mockDocument('hidden');
  const timers = [];
  initResumeStability({
    document: doc,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
  });
  doc.emit('visibilitychange', 'visible');
  assert.equal(doc.documentElement.classList.contains('is-resuming'), true);
  assert.equal(timers[0]?.ms >= 300, true);
  timers[0].fn();
  assert.equal(doc.documentElement.classList.contains('is-resuming'), false);
});

test('endBooting drops the first-paint motion lock', () => {
  const doc = mockDocument();
  doc.documentElement.classList.add('is-booting');
  endBooting({ document: doc });
  assert.equal(doc.documentElement.classList.contains('is-booting'), false);
});
