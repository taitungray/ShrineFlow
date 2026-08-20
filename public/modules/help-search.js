export const HELP_FEATURED_IDS = Object.freeze([
  'facebook-token-expired',
  'facebook-user-id',
  'public-media-url',
]);

export const HELP_KINDS = Object.freeze(['guide', 'troubleshoot', 'limit']);

export const HELP_TOPICS = Object.freeze([
  'start',
  'composer',
  'media',
  'facebook',
  'instagram',
  'threads',
  'schedule',
  'publish',
  'content',
  'team',
  'inbox',
  'settings',
]);

function searchableText(article = {}) {
  const steps = Array.isArray(article.steps) ? article.steps.join(' ') : '';
  const advanced = Array.isArray(article.advancedSteps) ? article.advancedSteps.join(' ') : '';
  const keywords = Array.isArray(article.keywords) ? article.keywords.join(' ') : String(article.keywords || '');
  return [
    article.id,
    article.title,
    article.summary,
    keywords,
    article.symptoms,
    article.cause,
    steps,
    advanced,
  ].join('\n').toLowerCase();
}

export function parseHelpLocation(hash = '') {
  const raw = String(hash || '').trim();
  const withoutHash = raw.replace(/^#\/?/, '');
  const questionAt = withoutHash.indexOf('?');
  const pathPart = (questionAt === -1 ? withoutHash : withoutHash.slice(0, questionAt)).replace(/\/+$/, '');
  const queryString = questionAt === -1 ? '' : withoutHash.slice(questionAt + 1);
  const query = new URLSearchParams(queryString).get('q') || '';

  if (pathPart !== 'help' && !pathPart.startsWith('help/')) {
    return { view: '', path: '', articleId: '', query: '' };
  }

  const articleId = pathPart.startsWith('help/') ? pathPart.slice('help/'.length) : '';
  return {
    view: 'help',
    path: pathPart || 'help',
    articleId,
    query,
  };
}

function matchesQuery(article, needle) {
  if (!needle) return true;
  const haystack = searchableText(article);
  if (haystack.includes(needle)) return true;
  const keywords = Array.isArray(article.keywords) ? article.keywords : [];
  return keywords.some((keyword) => {
    const fragment = String(keyword || '').trim().toLowerCase();
    return fragment.length >= 8 && needle.includes(fragment);
  });
}

export function filterHelpArticles(articles = [], query = '', filters = {}) {
  const kind = String(filters.kind || 'all').trim() || 'all';
  const topic = String(filters.topic || 'all').trim() || 'all';
  const needle = String(query || '').trim().toLowerCase();

  return (Array.isArray(articles) ? articles : []).filter((article) => {
    if (kind !== 'all' && article.kind !== kind) return false;
    if (topic !== 'all' && !(Array.isArray(article.topics) && article.topics.includes(topic))) return false;
    return matchesQuery(article, needle);
  });
}
