import { $, escapeHtml } from './dom.js';
import { HELP_ARTICLES } from './help-articles.js';
import { filterHelpArticles, HELP_FEATURED_IDS, parseHelpLocation } from './help-search.js';
import { LIST_PAGE_SIZE, paginate, removeListPager, syncListPager } from './pagination.js';

let helpPage = 1;
let lastHelpQueryKey = '';
let helpArticlePageLock = '';

const KIND_OPTIONS = [
  ['all', '全部'],
  ['guide', '怎麼做'],
  ['troubleshoot', '出問題了'],
  ['limit', '限制與做不到'],
];

const TOPIC_OPTIONS = [
  ['all', '全部'],
  ['start', '開始使用'],
  ['composer', '編輯與 AI'],
  ['media', '素材'],
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['threads', 'Threads'],
  ['schedule', '排程與日曆'],
  ['publish', '發布與失敗'],
  ['content', '內容與審核'],
  ['team', '團隊與權限'],
  ['insights', '成效與收件匣'],
  ['settings', '設定與備份'],
];

const KIND_LABEL = Object.fromEntries(KIND_OPTIONS.filter(([value]) => value !== 'all'));

const filters = {
  kind: 'all',
  topic: 'all',
};

function selectedRadio(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
}

function renderPills(target, name, options, selected) {
  if (!target) return;
  target.innerHTML = options.map(([value, label]) => (
    '<label class="radio-pill">'
    + '<input type="radio" name="' + name + '" value="' + escapeHtml(value) + '"'
    + (value === selected ? ' checked' : '') + ' />'
    + '<span>' + escapeHtml(label) + '</span></label>'
  )).join('');
}

function formatHelpText(text) {
  return escapeHtml(String(text || '')).replace(/「([^」]+)」/g, '<strong class="help-term">「$1」</strong>');
}

function helpBlock(kind, label, inner) {
  return '<section class="help-block help-block-' + kind + '">'
    + '<h3 class="help-section-label">' + escapeHtml(label) + '</h3>'
    + inner
    + '</section>';
}

function relatedHtml(links = []) {
  if (!links.length) return '';
  return helpBlock(
    'related',
    '相關畫面',
    '<p class="help-related">'
    + links.map((link) => '<a class="field-link" href="' + escapeHtml(link.href) + '">' + escapeHtml(link.label) + '</a>').join('')
    + '</p>',
  );
}

export function renderHelpStepsHtml(steps = []) {
  if (!steps.length) return '';
  return '<ol class="help-steps">' + steps.map((step) => '<li><span class="help-step-copy">' + formatHelpText(step) + '</span></li>').join('') + '</ol>';
}

function articleCard(article, { open = false } = {}) {
  const kind = KIND_LABEL[article.kind] ? article.kind : 'guide';
  const advanced = Array.isArray(article.advancedSteps) && article.advancedSteps.length
    ? '<details class="disclosure compact"><summary>完整步驟 <span class="chevron" aria-hidden="true">›</span></summary><div class="disclosure-body">'
      + renderHelpStepsHtml(article.advancedSteps) + '</div></details>'
    : '';
  return '<article class="help-article">'
    + '<details class="help-article-fold"' + (open ? ' open' : '') + ' data-help-id="' + escapeHtml(article.id) + '">'
    + '<summary>'
    + '<span class="help-kind-tag help-kind-tag--' + kind + '">' + escapeHtml(KIND_LABEL[kind]) + '</span>'
    + '<strong>' + escapeHtml(article.title) + '</strong>'
    + '<small>' + escapeHtml(article.summary) + '</small>'
    + '</summary>'
    + '<div class="help-article-body">'
    + helpBlock('symptom', '現象', '<p>' + formatHelpText(article.symptoms) + '</p>')
    + helpBlock('key', '重點', '<p>' + formatHelpText(article.cause) + '</p>')
    + helpBlock('steps', '步驟', renderHelpStepsHtml(article.steps) + advanced)
    + relatedHtml(article.related)
    + '</div></details></article>';
}

function syncHash({ articleId = '', query = '' } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  const path = articleId ? 'help/' + articleId : 'help';
  const next = '#/' + path + (params.toString() ? '?' + params.toString() : '');
  if (window.location.hash !== next) window.history.replaceState({}, '', next);
}

function featuredArticles() {
  const byId = new Map(HELP_ARTICLES.map((article) => [article.id, article]));
  return HELP_FEATURED_IDS.map((id) => byId.get(id)).filter(Boolean);
}

export function renderHelp() {
  const list = $('#helpArticleList');
  const status = $('#helpStatus');
  const search = $('#helpSearch');
  if (!list || !status) return;

  const location = parseHelpLocation(window.location.hash);
  if (search && document.activeElement !== search && location.view === 'help') {
    search.value = location.query;
  }

  filters.kind = selectedRadio('helpKind', filters.kind);
  filters.topic = selectedRadio('helpTopic', filters.topic);
  const query = String(search?.value || location.query || '').trim();
  const matches = filterHelpArticles(HELP_ARTICLES, query, filters);
  const knownIds = new Set(HELP_ARTICLES.map((article) => article.id));
  const missingArticle = location.articleId && !knownIds.has(location.articleId);
  const openId = !missingArticle && knownIds.has(location.articleId) ? location.articleId : '';

  if (!matches.length) {
    const featured = featuredArticles();
    status.textContent = '沒有符合的說明。改關鍵字，或先看這三則最常見的問題。';
    removeListPager(list);
    list.innerHTML = featured.map((article) => articleCard(article, { open: article.id === openId })).join('');
  } else {
    const queryKey = [query, filters.kind, filters.topic].join('|');
    if (queryKey !== lastHelpQueryKey) {
      helpPage = 1;
      lastHelpQueryKey = queryKey;
    }
    if (openId && openId !== helpArticlePageLock) {
      const index = matches.findIndex((article) => article.id === openId);
      if (index >= 0) helpPage = Math.floor(index / LIST_PAGE_SIZE) + 1;
      helpArticlePageLock = openId;
    }
    if (!openId) helpArticlePageLock = '';
    const paged = paginate(matches, { page: helpPage, pageSize: LIST_PAGE_SIZE });
    helpPage = paged.page;
    status.textContent = '共 ' + matches.length + ' 則說明。點標題展開。';
    list.innerHTML = paged.items.map((article) => articleCard(article, { open: article.id === openId })).join('');
    syncListPager(list, paged, {
      label: '說明分頁',
      onPage: (page) => {
        helpPage = page;
        renderHelp();
      },
    });
  }

  if (missingArticle) {
    status.textContent = '找不到這則說明。已改顯示搜尋結果。';
  }
}

function focusSearchOnDesktop() {
  const search = $('#helpSearch');
  if (!search) return;
  if (window.matchMedia('(min-width: 768px)').matches) search.focus();
}

export function initHelp() {
  renderPills($('#helpKindFilter'), 'helpKind', KIND_OPTIONS, 'all');
  renderPills($('#helpTopicFilter'), 'helpTopic', TOPIC_OPTIONS, 'all');

  const search = $('#helpSearch');
  search?.addEventListener('input', () => {
    syncHash({
      articleId: parseHelpLocation(window.location.hash).articleId,
      query: search.value.trim(),
    });
    renderHelp();
  });

  $('#helpKindFilter')?.addEventListener('change', () => renderHelp());
  $('#helpTopicFilter')?.addEventListener('change', () => renderHelp());

  $('#helpArticleList')?.addEventListener('toggle', (event) => {
    const fold = event.target;
    if (!(fold instanceof HTMLDetailsElement) || !fold.classList.contains('help-article-fold')) return;
    if (!fold.open) return;
    const id = fold.dataset.helpId || '';
    $('#helpArticleList').querySelectorAll('.help-article-fold[open]').forEach((other) => {
      if (other !== fold) other.open = false;
    });
    syncHash({
      articleId: id,
      query: String($('#helpSearch')?.value || '').trim(),
    });
  }, true);

  window.addEventListener('hashchange', () => {
    if (parseHelpLocation(window.location.hash).view !== 'help') return;
    renderHelp();
  });
  window.addEventListener('popstate', () => {
    if (parseHelpLocation(window.location.hash).view !== 'help') return;
    renderHelp();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('[data-view-target="help"]')) return;
    setTimeout(() => {
      renderHelp();
      focusSearchOnDesktop();
    }, 0);
  });

  renderHelp();
  if (parseHelpLocation(window.location.hash).view === 'help') focusSearchOnDesktop();
}
