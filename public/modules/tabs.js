import { $$, $ } from './dom.js';

const VIEW_ROUTES = {
  overview: 'overview',
  create: 'content/new',
  review: 'content/edit',
  drafts: 'content',
  schedule: 'calendar',
  media: 'media',
  templates: 'templates',
  campaigns: 'campaigns',
  publishing: 'publishing',
  insights: 'insights',
  inbox: 'inbox',
  platforms: 'platforms',
  settings: 'settings',
  errors: 'errors',
  team: 'team',
  reviews: 'reviews',
  help: 'help',
};

const PAGE_META = {
  overview: ['OVERVIEW', '總覽'],
  create: ['CONTENT / NEW', '新增內容'],
  review: ['CONTENT / EDIT', '編輯內容'],
  drafts: ['CONTENT', '內容'],
  schedule: ['CALENDAR', '日曆'],
  media: ['MEDIA', '素材庫'],
  templates: ['TEMPLATES', '模板'],
  campaigns: ['CAMPAIGNS', '活動'],
  publishing: ['PUBLISHING LOGS', '發布紀錄'],
  insights: ['INSIGHTS', '成效'],
  inbox: ['INBOX', '收件匣'],
  platforms: ['PLATFORMS', '平台連線'],
  settings: ['SETTINGS', '設定'],
  errors: ['ERROR LOG', '錯誤記錄'],
  team: ['TEAM & ACCESS', '團隊與權限'],
  reviews: ['REVIEW QUEUE', '審核佇列'],
  help: ['HELP', '幫助'],
};

function normalizeView(view = '') {
  if (view === 'content') return 'drafts';
  if (view === 'calendar') return 'schedule';
  return Object.prototype.hasOwnProperty.call(VIEW_ROUTES, view) ? view : 'overview';
}

export function routeFromHash(hash = typeof window !== 'undefined' ? window.location.hash : '') {
  const withoutHash = String(hash || '#/overview').replace(/^#\/?/, '');
  const path = withoutHash.split('?')[0].replace(/\/+$/, '') || 'overview';
  if (path === 'help' || path.startsWith('help/')) return { view: 'help', path };
  if (path === 'settings' || path.startsWith('settings/')) return { view: 'settings', path };
  if (path === 'content/new') return { view: 'create', path };
  if (path.startsWith('content/')) return { view: 'review', path };
  if (path === 'content') return { view: 'drafts', path };
  if (path === 'calendar') return { view: 'schedule', path };
  if (Object.values(VIEW_ROUTES).includes(path)) {
    const view = Object.keys(VIEW_ROUTES).find((key) => VIEW_ROUTES[key] === path) || 'overview';
    return { view, path };
  }
  return { view: 'overview', path: 'overview' };
}

function updatePageChrome(view) {
  const [section, title] = PAGE_META[view] || PAGE_META.overview;
  const sectionElement = $('#pageSectionTag');
  const titleElement = $('#currentPageTitle');
  if (sectionElement) sectionElement.textContent = section;
  if (titleElement) titleElement.textContent = title;
  document.title = `ShrineFlow · ${title}`;
}

function closeMobileNavigation() {
  const sidebar = $('#appSidebar');
  const scrim = $('#sidebarScrim');
  const menuButton = $('#mobileMenuToggle');
  const moreButton = $('#mobileMoreToggle');
  const closeButton = $('#mobileSidebarClose');
  sidebar?.classList.remove('is-open');
  scrim?.classList.remove('is-visible');
  menuButton?.setAttribute('aria-expanded', 'false');
  moreButton?.setAttribute('aria-expanded', 'false');
  closeButton?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('nav-open');
}

let lastComposerView = '';

export function resetViewScroll({ window: win = window, document: doc = document } = {}) {
  win.scrollTo?.(0, 0);
  if (doc.documentElement) doc.documentElement.scrollTop = 0;
  if (doc.body) doc.body.scrollTop = 0;
  doc.querySelectorAll?.('.composer-editor-pane, .composer-preview-pane, .review-preview').forEach((pane) => {
    pane.scrollTop = 0;
  });
}

export function dismissOpenDialogs({ document: doc = document } = {}) {
  doc.querySelectorAll?.('dialog[open]').forEach((dialog) => {
    if (typeof dialog.close === 'function') dialog.close();
  });
}

export function setComposerMode(mode = 'edit') {
  const composer = $('#composerPanel');
  if (!composer) return;
  const normalizedMode = mode === 'preview' ? 'preview' : 'edit';
  composer.dataset.composerMode = normalizedMode;
  $$('.composer-mode-button').forEach((button) => {
    const active = button.dataset.composerMode === normalizedMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

export function setActiveView(view, { syncHash = true, routePath = '' } = {}) {
  const normalizedView = normalizeView(view);
  const activePath = routePath || VIEW_ROUTES[normalizedView] || VIEW_ROUTES.overview;

  $$('[data-view-panel]').forEach((panel) => {
    const isComposer = panel.dataset.viewPanel === 'composer' && ['create', 'review'].includes(normalizedView);
    panel.classList.toggle('is-hidden', panel.dataset.viewPanel !== normalizedView && !isComposer);
  });

  const enteringComposer = ['create', 'review'].includes(normalizedView);
  if (enteringComposer && lastComposerView !== normalizedView) {
    setComposerMode(normalizedView === 'review' ? 'preview' : 'edit');
  }
  lastComposerView = enteringComposer ? normalizedView : '';

  $$('[data-view-target]').forEach((item) => {
    const targetView = normalizeView(item.dataset.viewTarget);
    const targetPath = item.dataset.routeTarget || VIEW_ROUTES[targetView];
    const isContentRoute = activePath.startsWith('content/');
    const isActive = targetView === normalizedView
      || (isContentRoute && targetPath === 'content')
      || (normalizedView === 'drafts' && targetPath === 'content')
      || (normalizedView === 'schedule' && targetPath === 'calendar');
    item.classList.toggle('active', isActive);
    if (item.tagName === 'A') {
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    if (item.hasAttribute('aria-selected')) item.setAttribute('aria-selected', String(isActive));
  });

  updatePageChrome(normalizedView);
  closeMobileNavigation();
  dismissOpenDialogs();
  resetViewScroll();

  if (syncHash) {
    const nextHash = '#/' + activePath;
    if (window.location.hash !== nextHash) window.history.pushState({}, '', nextHash);
  }
}

function initMobileNavigation() {
  const sidebar = $('#appSidebar');
  const scrim = $('#sidebarScrim');
  const menuButton = $('#mobileMenuToggle');
  const moreButton = $('#mobileMoreToggle');
  const closeButton = $('#mobileSidebarClose');
  const setOpen = (isOpen) => {
    sidebar?.classList.toggle('is-open', isOpen);
    scrim?.classList.toggle('is-visible', isOpen);
    menuButton?.setAttribute('aria-expanded', String(isOpen));
    moreButton?.setAttribute('aria-expanded', String(isOpen));
    document.body.classList.toggle('nav-open', isOpen);
  };

  menuButton?.addEventListener('click', () => setOpen(!sidebar?.classList.contains('is-open')));
  moreButton?.addEventListener('click', () => setOpen(!sidebar?.classList.contains('is-open')));
  closeButton?.addEventListener('click', () => setOpen(false));
  scrim?.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
}

export function initTabs() {
  $$('[data-view-target]').forEach((item) => {
    item.addEventListener('click', () => {
      setActiveView(item.dataset.viewTarget, { routePath: item.dataset.routeTarget || '' });
    });
  });
  $$('.composer-mode-button').forEach((button) => {
    button.addEventListener('click', () => setComposerMode(button.dataset.composerMode));
  });
  window.addEventListener('hashchange', () => {
    const route = routeFromHash();
    setActiveView(route.view, { syncHash: false, routePath: route.path });
  });
  window.addEventListener('popstate', () => {
    const route = routeFromHash();
    setActiveView(route.view, { syncHash: false, routePath: route.path });
  });
  initMobileNavigation();
  const route = routeFromHash();
  setActiveView(route.view, { syncHash: false, routePath: route.path });
}
