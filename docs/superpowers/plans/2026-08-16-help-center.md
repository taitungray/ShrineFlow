# Help Center Implementation Plan

> **For agentic workers:** Execute inline in this session. Do not auto-commit.

**Goal:** 後台側邊新增可搜尋的幫助頁，涵蓋規格第 6 節全部條目。

**Architecture:** 靜態文章資料 + 純函式搜尋／路由解析 + 單一面板渲染。無 CMS、無新 API。

**Tech Stack:** Express 靜態頁、ES modules、`node --test`、既有 `ui-ux-pro-max` 元件。

## Global Constraints

- 版號同步 `package.json` 與 `public/index.html` 的 `?v=`
- 2～4 選項用 `.radio-pill-group`，禁止幫助主題用 `<select>`
- `.platform-tabs` 類導覽禁止 `overflow-x: auto`；pill 用 `flex-wrap`
- `.panel` `min-height: 540px`
- 表單欄位用 `.field` + 獨立 `label for`
- 不 commit，除非使用者明確要求
- 只跑 `node --test test/help-articles.test.js test/help-search.test.js`（若分檔）與必要的 `tabs` 若改到會破的測試

## Files

- Create: `public/modules/help-search.js` — `parseHelpLocation`, `filterHelpArticles`, `HELP_FEATURED_IDS`
- Create: `public/modules/help-articles.js` — `HELP_ARTICLES`（規格全部 id）
- Create: `public/modules/help.js` — 渲染與事件
- Create: `test/help-search.test.js`
- Modify: `public/modules/tabs.js` — `help` 路由，支援 `help/<id>` 與 `help?q=`
- Modify: `public/index.html` — 側邊連結、幫助面板、`?v=`
- Modify: `public/style.css` — 幫助列表樣式
- Modify: `public/app.js` — `initHelp()`
- Modify: `package.json` — version `0.6.03`
- Modify: `docs/superpowers/specs/2026-08-16-help-center-design.md` — 狀態改已核准／實作

## Interfaces

```js
export const HELP_FEATURED_IDS = Object.freeze([
  'facebook-token-expired',
  'facebook-user-id',
  'public-media-url',
]);

export function parseHelpLocation(hash = '') {
  // '#/help/facebook-user-id?q=token' →
  // { view: 'help', articleId: 'facebook-user-id', query: 'token', path: 'help/facebook-user-id' }
  // 非 help → { view: '', articleId: '', query: '', path: '' }
}

export function filterHelpArticles(articles, query = '', filters = {}) {
  // filters.kind: 'all' | 'guide' | 'troubleshoot' | 'limit'
  // filters.topic: 'all' | start|composer|media|facebook|instagram|threads|schedule|publish|content|team|insights|settings
  // 回傳符合的文章陣列，維持原順序
}

export const HELP_ARTICLES = [ /* 每則含 id, kind, topics, title, summary, keywords, symptoms, cause, steps, related */ ];
```

---

### Task 1: 搜尋與 hash 解析（TDD）

**Files:** Create `test/help-search.test.js`, `public/modules/help-search.js`

- [ ] 寫失敗測試
- [ ] 跑測確認失敗
- [ ] 最小實作
- [ ] 跑測通過

測試行為：

1. `Unsupported post request` 命中 `facebook-user-id`
2. `code 190` 命中 `facebook-token-expired`
3. `kind: troubleshoot` 排除 guide
4. `topic: facebook` 只留含該 topic 的
5. 空 query + all filters 回全部
6. `parseHelpLocation('#/help/facebook-user-id')` 解析 id
7. `parseHelpLocation('#/help?q=Token')` 解析 query
8. 未知 hash 不是 help view

---

### Task 2: 文章目錄

**Files:** `public/modules/help-articles.js`、測試補「規格全部 id 都存在且四段齊」

- [ ] 測試列出規格全部 id，assert 每則有 title/summary/keywords/symptoms/cause/steps/related
- [ ] 實作全部文章（對齊規格 §6，步驟寫到操作者能做完）
- [ ] 長文 `facebook-connect` 另有 `advancedSteps`

---

### Task 3: 路由 + 畫面

**Files:** `tabs.js`, `index.html`, `help.js`, `app.js`, `style.css`, `package.json`

- [ ] `VIEW_ROUTES.help = 'help'`；`path === 'help' || path.startsWith('help/')` 進幫助頁；hash 先去掉 `?query`
- [ ] 側邊設定下方「幫助」；`#helpPanel`
- [ ] 搜尋、類型 pill、主題 pill、結果卡、無結果秀 featured 三則
- [ ] 深連結展開對應卡；找不到 id 顯示「找不到這則說明」
- [ ] 版號 `0.6.03`

不跑全套 `node --test`。
