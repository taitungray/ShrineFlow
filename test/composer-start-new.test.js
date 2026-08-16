import test from 'node:test';
import assert from 'node:assert/strict';

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
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    dataset: {},
    classList: mockClassList(),
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    hasAttribute() { return false; },
    matches() { return false; },
    closest() { return null; },
    reset() {
      this.value = '';
    },
    ...init,
  };
}

function installDom(extra = {}) {
  global.HTMLSelectElement = global.HTMLSelectElement || class HTMLSelectElement {};
  global.HTMLTextAreaElement = global.HTMLTextAreaElement || class HTMLTextAreaElement {};
  global.HTMLInputElement = global.HTMLInputElement || class HTMLInputElement {};
  const byId = {
    composerPanel: mockEl({ dataset: { composerMode: 'preview' } }),
    generateForm: mockEl({
      reset() {
        byId.contentTopic.value = '';
        byId.extraNotes.value = '';
        byId.facebookText.value = '';
        byId.reelText.value = '';
        byId.hashtagsText.value = '#品牌內容 #社群經營 #內容行銷';
        byId.defaultHashtags.value = '#品牌內容 #社群經營 #內容行銷';
        byId.targetScheduledAt.value = '';
      },
    }),
    contentTopic: mockEl({ value: '邢府四千歲' }),
    extraNotes: mockEl({ value: '金箔質感' }),
    facebookText: mockEl({ value: '親手彩繪的邢府四千歲作品終於完成了！' }),
    reelText: mockEl({ value: 'Reel 文案' }),
    hashtagsText: mockEl({ value: '#舊標籤' }),
    defaultHashtags: mockEl({ value: '#舊標籤' }),
    targetScheduledAt: mockEl({ value: '2026-08-18T13:00' }),
    targetFirstComment: mockEl({ value: '首則留言' }),
    draftState: mockEl({ textContent: '已排程', classList: mockClassList() }),
    previewMediaGallery: mockEl({ innerHTML: '<figure></figure>' }),
    previewImageWrap: mockEl({ hidden: false, classList: mockClassList() }),
    facebookPreview: mockEl({ innerHTML: '<p>舊文案</p>' }),
    hashtagsPreview: mockEl({ textContent: '#舊標籤' }),
    uploadPreviewGallery: mockEl({ innerHTML: '<figure></figure>' }),
    uploadZone: mockEl({ classList: mockClassList() }),
    versionHistory: mockEl({ hidden: false }),
    saveButton: mockEl({ disabled: false }),
    scheduleButton: mockEl({ disabled: false }),
    publishNowButton: mockEl({ disabled: false, dataset: {} }),
    autosaveStatus: mockEl({ hidden: false, textContent: '已載入草稿', dataset: {} }),
    autosaveRetryButton: mockEl({ hidden: false, disabled: false }),
    formMessage: mockEl({ textContent: '文案已產生', dataset: {} }),
    previewMessage: mockEl({ textContent: '已交 Facebook 排程佇列', dataset: {} }),
    createContentType: mockEl(),
    createContentSettings: mockEl(),
    targetAccountChecks: mockEl(),
    activeTargetTabs: mockEl(),
    approvalStateBadge: mockEl({ textContent: '審核未啟用', dataset: {} }),
    pageSectionTag: mockEl({ textContent: 'CONTENT / EDIT' }),
    currentPageTitle: mockEl({ textContent: '編輯內容' }),
    appSidebar: mockEl({ classList: mockClassList() }),
    sidebarScrim: mockEl({ classList: mockClassList() }),
    ...extra,
  };
  byId.draftState.classList.add('ready');

  const listeners = [];
  const doc = {
    title: '',
    documentElement: { scrollTop: 40 },
    body: { scrollTop: 40, classList: mockClassList() },
    querySelector(selector) {
      const id = String(selector).startsWith('#') ? String(selector).slice(1) : '';
      if (id && byId[id]) return byId[id];
      if (selector === '.copy-card') return null;
      if (selector === 'input[name="postType"][value="intro"]') return mockEl({ checked: true });
      return null;
    },
    getElementById(id) {
      return byId[id] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-view-panel]') return [];
      if (selector === '[data-view-target]') return extra.viewTargets || [];
      if (selector === '.composer-mode-button') return [];
      if (selector === 'dialog[open]') return [];
      if (selector === '.composer-editor-pane, .composer-preview-pane, .review-preview') return [];
      return [];
    },
    addEventListener(name, fn) { listeners.push([name, fn]); },
  };

  global.document = doc;
  global.window = global;
  global.window.scrollTo = () => {};
  global.window.location = { hash: extra.hash || '#/content/new' };
  global.window.history = { pushState() {} };
  global.window.addEventListener = (name, fn) => listeners.push([name, fn]);
  global.localStorage = {
    getItem() { return extra.storage?.[arguments[0]] || null; },
    setItem() {},
    removeItem() {},
  };

  return { byId, listeners, doc };
}

test('startNewComposer clears a scheduled post so 新增內容 is a blank composer', async () => {
  const { byId } = installDom();
  const { state } = await import('../public/modules/state.js');
  state.savedPost = {
    id: 'post-scheduled',
    status: 'scheduled',
    facebook: '親手彩繪的邢府四千歲作品終於完成了！',
    mediaPaths: ['/uploads/statue-1.jpg', '/uploads/statue-2.jpg'],
    version: 3,
  };
  state.generated = { ...state.savedPost };
  state.editorDirty = false;
  state.selectedMediaItems = [
    { source: '/uploads/statue-1.jpg', serverPath: '/uploads/statue-1.jpg' },
    { source: '/uploads/statue-2.jpg', serverPath: '/uploads/statue-2.jpg' },
  ];
  state.activeTargetId = 'acct-fb';
  state.selectedTargetAccountIds = ['acct-fb'];

  const { startNewComposer } = await import('../public/modules/editor.js');
  startNewComposer();

  assert.equal(state.savedPost, null);
  assert.equal(state.generated, null);
  assert.equal(state.editorDirty, false);
  assert.deepEqual(state.selectedMediaItems, []);
  assert.equal(byId.contentTopic.value, '');
  assert.equal(byId.facebookText.value, '');
  assert.equal(byId.reelText.value, '');
  assert.equal(byId.hashtagsText.value, '#品牌內容 #社群經營 #內容行銷');
  assert.equal(byId.draftState.textContent, '尚未產生');
  assert.equal(byId.previewMediaGallery.innerHTML, '');
  assert.equal(byId.facebookPreview.innerHTML, '尚未產生文案。');
  assert.equal(byId.saveButton.disabled, true);
  assert.equal(byId.scheduleButton.disabled, true);
});

test('clicking 新增內容 starts a new composer even when already on create view', async () => {
  const started = [];
  const createLink = mockEl({
    dataset: { viewTarget: 'create', routeTarget: 'content/new' },
    tagName: 'A',
  });
  const clicks = [];
  createLink.addEventListener = (name, fn) => {
    if (name === 'click') clicks.push(fn);
  };

  installDom({ viewTargets: [createLink], hash: '#/content/new' });
  const { initTabs } = await import('../public/modules/tabs.js');
  initTabs({ onStartCreate: () => started.push('new') });

  assert.equal(clicks.length, 1, 'create link must bind click');
  clicks[0]();
  assert.deepEqual(started, ['new']);
});

test('opening create without startNew leaves composer for template apply', async () => {
  const started = [];
  installDom({ hash: '#/templates' });
  const { initTabs, setActiveView } = await import('../public/modules/tabs.js');
  initTabs({ onStartCreate: () => started.push('new') });
  started.length = 0;

  setActiveView('create', { syncHash: false });
  assert.deepEqual(started, []);
});
