import test from 'node:test';
import assert from 'node:assert/strict';
import { filterHelpArticles, parseHelpLocation } from '../public/modules/help-search.js';

const FIXTURES = [
  {
    id: 'facebook-user-id',
    kind: 'troubleshoot',
    topics: ['facebook'],
    title: 'Facebook 說 Object does not exist',
    summary: '貼了 User ID 不是粉專 ID',
    keywords: ['Unsupported post request', 'does not exist', 'cannot be loaded'],
    symptoms: '排程或發布出現 Unsupported post request',
    cause: '用了個人 User ID 或 User token',
    steps: ['到 Graph Explorer GET me/accounts'],
  },
  {
    id: 'facebook-token-expired',
    kind: 'troubleshoot',
    topics: ['facebook', 'settings'],
    title: 'Token 已過期',
    summary: 'code 190 表示 token 失效',
    keywords: ['code 190', 'expired access token', 'session has expired'],
    symptoms: '連線測過但發布失敗',
    cause: '短效 User token 或已撤銷',
    steps: ['開 Token Debugger 看過期時間'],
  },
  {
    id: 'getting-started',
    kind: 'guide',
    topics: ['start'],
    title: '第一次使用：建議順序',
    summary: '先接品牌再發文',
    keywords: ['開始', '入門'],
    symptoms: '不知道先做哪一步',
    cause: '後台功能多，沒有建議路徑',
    steps: ['登入後先選品牌'],
  },
  {
    id: 'cannot-do',
    kind: 'limit',
    topics: ['start'],
    title: '目前不做的功能',
    summary: '沒有廣告投放',
    keywords: ['Boost', '廣告'],
    symptoms: '找不到廣告按鈕',
    cause: '產品範圍不含廣告',
    steps: ['改用 Meta 廣告管理員'],
  },
];

test('search matches Facebook Graph English error text to the page-id article', () => {
  const query = "Unsupported post request. Object with ID '1701654120897096' does not exist, cannot be loaded due to missing permissions";
  const results = filterHelpArticles(FIXTURES, query);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'facebook-user-id');
});

test('search matches token expiry code 190', () => {
  const results = filterHelpArticles(FIXTURES, 'code 190');
  assert.equal(results.map((article) => article.id).includes('facebook-token-expired'), true);
});

test('kind filter keeps only troubleshooting articles', () => {
  const results = filterHelpArticles(FIXTURES, '', { kind: 'troubleshoot' });
  assert.deepEqual(results.map((article) => article.id), ['facebook-user-id', 'facebook-token-expired']);
});

test('topic filter keeps Facebook articles', () => {
  const results = filterHelpArticles(FIXTURES, '', { topic: 'facebook' });
  assert.ok(results.every((article) => article.topics.includes('facebook')));
  assert.equal(results.length, 2);
});

test('empty query and all filters return every article in original order', () => {
  const results = filterHelpArticles(FIXTURES, '', { kind: 'all', topic: 'all' });
  assert.deepEqual(results.map((article) => article.id), FIXTURES.map((article) => article.id));
});

test('parseHelpLocation reads article id from hash path', () => {
  assert.deepEqual(parseHelpLocation('#/help/facebook-user-id'), {
    view: 'help',
    path: 'help/facebook-user-id',
    articleId: 'facebook-user-id',
    query: '',
  });
});

test('parseHelpLocation reads search query from hash', () => {
  assert.deepEqual(parseHelpLocation('#/help?q=Token'), {
    view: 'help',
    path: 'help',
    articleId: '',
    query: 'Token',
  });
});

test('parseHelpLocation keeps article id and query together', () => {
  assert.deepEqual(parseHelpLocation('#/help/facebook-user-id?q=token'), {
    view: 'help',
    path: 'help/facebook-user-id',
    articleId: 'facebook-user-id',
    query: 'token',
  });
});

test('parseHelpLocation ignores non-help hashes', () => {
  assert.equal(parseHelpLocation('#/settings').view, '');
});
