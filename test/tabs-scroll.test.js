import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissOpenDialogs, resetViewScroll } from '../public/modules/tabs.js';

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

  assert.deepEqual(scrollCalls, [[0, 0]]);
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
