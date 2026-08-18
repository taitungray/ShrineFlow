import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof global.localStorage === 'undefined') {
  const memory = new Map();
  global.localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(String(key), String(value)); },
    removeItem(key) { memory.delete(String(key)); },
    clear() { memory.clear(); },
  };
}

function mockClassList() {
  const names = new Set();
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

function mockEl(init = {}) {
  const children = [];
  const el = {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    checked: false,
    src: '',
    alt: '',
    title: '',
    type: '',
    className: '',
    tagName: 'DIV',
    files: [],
    dataset: {},
    classList: mockClassList(),
    children,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    hasAttribute() { return false; },
    matches() { return false; },
    closest() { return null; },
    append(...nodes) {
      children.push(...nodes);
      this.innerHTML += nodes.map((node) => {
        if (node?.tagName === 'IMG' || node?.tagName === 'VIDEO') {
          return '<' + String(node.tagName).toLowerCase() + ' src="' + (node.src || '') + '">';
        }
        if (node?.tagName === 'FIGURE') {
          const media = (node.children || []).find((child) => child.tagName === 'IMG' || child.tagName === 'VIDEO');
          return '<figure>' + (media ? '<' + String(media.tagName).toLowerCase() + ' src="' + (media.src || '') + '">' : '') + '</figure>';
        }
        return node?.outerHTML || '';
      }).join('');
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    reset() {
      this.value = '';
    },
    ...init,
  };
  return el;
}

function installDom() {
  global.HTMLSelectElement = global.HTMLSelectElement || class HTMLSelectElement {};
  global.HTMLTextAreaElement = global.HTMLTextAreaElement || class HTMLTextAreaElement {};
  global.HTMLInputElement = global.HTMLInputElement || class HTMLInputElement {};
  global.DataTransfer = class DataTransfer {
    constructor() {
      this.items = { add() {} };
      this.files = [];
    }
  };
  global.URL = {
    revokeObjectURL() {},
    createObjectURL() { return 'blob:test'; },
  };

  const byId = {
    facebookText: mockEl({ value: '' }),
    reelText: mockEl({ value: '' }),
    defaultHashtags: mockEl({ value: '' }),
    contentTopic: mockEl({ value: '' }),
    extraNotes: mockEl({ value: '' }),
    hashtagsText: mockEl({ value: '' }),
    draftState: mockEl({ classList: mockClassList() }),
    saveButton: mockEl({ disabled: false }),
    scheduleButton: mockEl({ disabled: false }),
    publishNowButton: mockEl({ disabled: false, dataset: {} }),
    previewMediaGallery: mockEl({ innerHTML: '' }),
    previewImageWrap: mockEl({ hidden: true, classList: mockClassList() }),
    uploadPreviewGallery: mockEl({ innerHTML: '' }),
    uploadZone: mockEl({ classList: mockClassList() }),
    imageInput: mockEl({ files: [] }),
    createContentType: mockEl(),
    createContentSettings: mockEl(),
    targetAccountChecks: mockEl(),
    activeTargetTabs: mockEl(),
    autosaveStatus: mockEl({ hidden: false, textContent: '', dataset: {} }),
    autosaveRetryButton: mockEl({ hidden: true, disabled: false }),
    facebookPreview: mockEl({ innerHTML: '' }),
    hashtagsPreview: mockEl({ textContent: '' }),
    previewPlatformStatus: mockEl({ hidden: true, dataset: {} }),
    formMessage: mockEl({ textContent: '', dataset: {} }),
    previewMessage: mockEl({ textContent: '', dataset: {} }),
    targetScheduledAt: mockEl({ value: '' }),
    targetFirstComment: mockEl({ value: '' }),
    targetContentType: mockEl(),
  };

  const doc = {
    title: '',
    documentElement: { scrollTop: 0 },
    body: { scrollTop: 0, classList: mockClassList() },
    querySelector(selector) {
      const id = String(selector).startsWith('#') ? String(selector).slice(1) : '';
      if (id && byId[id]) return byId[id];
      if (selector === 'input[name="postType"][value="intro"]') return mockEl({ checked: true });
      if (String(selector).startsWith('input[name="postType"]')) return mockEl({ checked: true });
      return null;
    },
    getElementById(id) {
      return byId[id] || null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement(tag) {
      return mockEl({ tagName: String(tag).toUpperCase() });
    },
  };

  global.document = doc;
  global.window = global;
  global.window.scrollTo = () => {};
  global.window.location = { hash: '#/publishing' };
  global.window.history = { pushState() {} };
  global.window.addEventListener = () => {};
  global.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };

  return { byId };
}

test('mediaPathsOf falls back to target media when the post has none', async () => {
  const { mediaPathsOf } = await import('../public/modules/state.js');
  assert.deepEqual(mediaPathsOf({
    mediaPaths: [],
    targets: [{ mediaPaths: ['/uploads/altar.jpg'] }],
  }), ['/uploads/altar.jpg']);
});

test('opening a saved post fills the composer media zone from stored paths', async () => {
  const { byId } = installDom();
  const { state } = await import('../public/modules/state.js');
  state.selectedMediaItems = [{ source: '/uploads/leftover.jpg', serverPath: '/uploads/leftover.jpg' }];
  state.savedPost = {
    id: 'post-published',
    status: 'scheduled',
    updatedAt: '2026-08-18T13:23:00.000Z',
    facebook: '金箔層次完成。',
    mediaPaths: ['/uploads/statue-1.jpg', '/uploads/statue-2.jpg'],
    targets: [{ id: 't1', accountId: 'facebook:default', platformId: 'facebook', status: 'publishing' }],
  };
  state.generated = null;
  state.editorDirty = false;
  state.posts = [state.savedPost];
  state.accounts = [];
  state.platforms = [];
  state.clients = [];

  const { renderGenerated } = await import('../public/modules/editor.js');
  renderGenerated(state.savedPost);

  assert.deepEqual(
    state.selectedMediaItems.map((item) => item.serverPath),
    ['/uploads/statue-1.jpg', '/uploads/statue-2.jpg'],
    'composer selection must replace leftover files with the opened post media',
  );
  assert.equal(byId.uploadZone.classList.contains('has-media'), true, '素材區 must show the loaded files');
  assert.match(byId.uploadPreviewGallery.innerHTML, /statue-1\.jpg/, '素材區 gallery must render the first image');
  assert.match(byId.previewMediaGallery.innerHTML, /statue-1\.jpg/, '右側預覽 must also show the image');
});
