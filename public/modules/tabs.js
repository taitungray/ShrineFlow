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
};

function normalizeView(view = '') {
  if (view === 'content') return 'drafts';
  if (view === 'calendar') return 'schedule';
  return Object.prototype.hasOwnProperty.call(VIEW_ROUTES, view) ? view : 'overview';
}

function routeFromHash() {
  const path = String(window.location.hash || '#/overview').replace(/^#\/?/, '').replace(/\/+$/, '') || 'overview';
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
  sidebar?.classList.remove('is-open');
  scrim?.classList.remove('is-visible');
  menuButton?.setAttribute('aria-expanded', 'false');
  moreButton?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('nav-open');
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

  if (['create', 'review'].includes(normalizedView)) setComposerMode(normalizedView === 'review' ? 'preview' : 'edit');

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
  const setOpen = (isOpen) => {
    sidebar?.classList.toggle('is-open', isOpen);
    scrim?.classList.toggle('is-visible', isOpen);
    menuButton?.setAttribute('aria-expanded', String(isOpen));
    moreButton?.setAttribute('aria-expanded', String(isOpen));
    document.body.classList.toggle('nav-open', isOpen);
  };

  menuButton?.addEventListener('click', () => setOpen(!sidebar?.classList.contains('is-open')));
  moreButton?.addEventListener('click', () => setOpen(!sidebar?.classList.contains('is-open')));
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
