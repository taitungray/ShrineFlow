# Facebook Token Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Facebook 設定頁與幫助中心使用同一套長期 Page Token 流程，並提供可點擊的 Meta 官方工具網址。

**Architecture:** 沿用靜態 `HELP_ARTICLES` 與現有設定頁 disclosure。幫助文章的 `related` 同時支援內部 hash 與受信任 HTTPS 外部連結；設定頁直接顯示相同三個官方工具連結與固定八步驟。

**Tech Stack:** Express 靜態 HTML、ES modules、`node:test`、既有 `ui-ux-pro-max` 元件。

## Global Constraints

- 保留工作樹現有未提交修改，只改本計畫列出的區段。
- 不新增依賴、不自動交換或儲存 Meta App Secret。
- 官方網址固定為 `https://developers.facebook.com/apps/`、`https://developers.facebook.com/tools/explorer/`、`https://developers.facebook.com/tools/debug/accesstoken/`。
- 外部連結使用 `target="_blank"` 與 `rel="noopener"`。
- 設定頁與幫助中心順序一致：User token → 確認本人 → 延伸 → 貼回 Explorer → `me/accounts` → 取 Page token → Debugger 驗證 → ShrineFlow 儲存測試。
- 版本由 `0.6.20` 升至 `0.6.21`，同步 `package.json` 與 `public/index.html` 靜態資源查詢參數。
- 只跑 `node --test test/help-articles.test.js test/help-search.test.js`。
- 不 commit，除非使用者明確要求。

---

### Task 1: 幫助中心固定流程與官方連結

**Files:**
- Modify: `test/help-articles.test.js:72-105`
- Modify: `public/modules/help-articles.js:314-398`
- Modify: `public/modules/help.js:49-54`

**Interfaces:**
- Consumes: `article.related: Array<{ label: string, href: string }>`
- Produces: `relatedHtml()` 對 `#/` 連結維持站內導覽，對 `https://developers.facebook.com/` 連結加安全外開屬性。

- [ ] **Step 1: 寫失敗測試**

在 `test/help-articles.test.js` 加入官方網址常數，將 related 驗證改為只允許站內 hash 或三個官方網址，並驗證 `facebook-connect` 含完整網址與固定流程：

```js
const META_TOOL_URLS = [
  'https://developers.facebook.com/apps/',
  'https://developers.facebook.com/tools/explorer/',
  'https://developers.facebook.com/tools/debug/accesstoken/',
];

function isAllowedRelatedHref(href = '') {
  return String(href).startsWith('#/') || META_TOOL_URLS.includes(String(href));
}

assert.ok(article.related.every((link) => link.label && isAllowedRelatedHref(link.href)), id);

test('facebook connect documents the canonical long-lived Page token flow and official tools', () => {
  const article = HELP_ARTICLES.find((item) => item.id === 'facebook-connect');
  const instructions = [...article.steps, ...article.advancedSteps].join(' ');
  assert.deepEqual(
    META_TOOL_URLS.every((href) => article.related.some((link) => link.href === href)),
    true,
  );
  assert.match(instructions, /me\?fields=id,name/);
  assert.match(instructions, /延伸存取權杖/);
  assert.match(instructions, /me\/accounts\?fields=id,name,access_token/);
  assert.match(instructions, /Type: Page/);
  assert.match(instructions, /Expires: Never/);
  assert.ok(instructions.indexOf('延伸存取權杖') < instructions.indexOf('me/accounts?fields=id,name,access_token'));
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/help-articles.test.js`

Expected: FAIL，指出 `facebook-connect` 缺官方網址或延伸順序不符。

- [ ] **Step 3: 更新文章資料**

將 `facebook-connect` 改成簡短四步驟加完整八步驟；完整步驟必須依序包含：

```js
steps: [
  '先產生並延伸 User token；不要直接把短效 token 拿去換粉專 token。',
  '延伸後貼回 Graph Explorer，再用 me/accounts 取得同一筆粉專 id 與 access_token。',
  'Token Debugger 確認粉專 token 為 Type: Page、Expires: Never、Is Valid: True。',
  '貼進 ShrineFlow → 儲存此品牌 FB 連線 → 測試；成功必須顯示粉專名稱。',
],
advancedSteps: [
  'Graph API Explorer 選 ShrineFlow 使用的 Meta App，產生 User token。',
  '執行 me?fields=id,name；name 必須是操作者本人，不是粉專。',
  'Access Token Debugger 貼 User token，按「延伸存取權杖」（Extend Access Token）。',
  '將延伸後 User token 貼回 Graph API Explorer。',
  '執行 me/accounts?fields=id,name,access_token&limit=100。',
  '從目標粉專同一筆資料複製 id 與 access_token。',
  'Access Token Debugger 檢查粉專 token：Type: Page、Expires: Never、Is Valid: True。',
  '將粉專 ID 與 Page Access Token 貼進 ShrineFlow，儲存後測試連線。',
  '若出現 Tried accessing nonexisting field (accounts) on node type (Page)，代表目前用 Page token 執行 me/accounts；切回延伸後 User token。',
],
related: [
  { label: '設定 · Facebook', href: '#/settings/facebook' },
  { label: '粉專 ID 錯誤', href: '#/help/facebook-user-id' },
  { label: 'Meta Apps', href: 'https://developers.facebook.com/apps/' },
  { label: 'Graph API Explorer', href: 'https://developers.facebook.com/tools/explorer/' },
  { label: 'Access Token Debugger', href: 'https://developers.facebook.com/tools/debug/accesstoken/' },
],
```

同步改寫 `facebook-token-expired`，明確寫「先延伸 User token，再執行 `me/accounts`」，不得保留相反順序。

- [ ] **Step 4: 安全外開官方連結**

將 `relatedHtml` 改為：

```js
function relatedHtml(links = []) {
  if (!links.length) return '';
  return '<p class="help-related-label">相關畫面與工具</p><p class="help-related">'
    + links.map((link) => {
      const href = String(link.href || '');
      const external = href.startsWith('https://developers.facebook.com/');
      const attributes = external ? ' target="_blank" rel="noopener"' : '';
      return '<a class="field-link" href="' + escapeHtml(href) + '"' + attributes + '>'
        + escapeHtml(link.label) + '</a>';
    }).join('')
    + '</p>';
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `node --test test/help-articles.test.js test/help-search.test.js`

Expected: 所有測試 PASS。

---

### Task 2: Facebook 設定頁對齊與版本同步

**Files:**
- Modify: `public/index.html:439-520`
- Modify: `public/index.html:15,1330`
- Modify: `package.json:3`

**Interfaces:**
- Consumes: 無。
- Produces: Facebook 設定頁固定八步驟與三個可點擊官方工具網址。

- [ ] **Step 1: 更新設定頁快速連結**

`Page Access Token` 欄位旁顯示三個連結：

```html
<a class="field-link" href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">Meta Apps →</a>
<a class="field-link" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph Explorer →</a>
<a class="field-link" href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noopener">Token Debugger →</a>
```

- [ ] **Step 2: 將取得 Token 說明改為單一固定流程**

保留建 App 與權限說明；刪除「第一次先拿短效粉專 Token／之後再換長期」分段，換成八步驟：

```html
<p class="setup-subtitle">固定流程：取得長期粉專 Token</p>
<ol class="setup-steps">
  <li>Graph API Explorer 選 ShrineFlow 使用的 Meta App，產生 <strong>User token</strong>。</li>
  <li>執行 <code>me?fields=id,name</code>；<code>name</code> 必須是你本人，不是粉專。</li>
  <li>Access Token Debugger 貼 User token，按<strong>延伸存取權杖</strong>。</li>
  <li>把延伸後 User token 貼回 Graph API Explorer。</li>
  <li>執行 <code>me/accounts?fields=id,name,access_token&amp;limit=100</code>。</li>
  <li>從目標粉專同一筆資料複製 <code>id</code> 與 <code>access_token</code>。</li>
  <li>Debugger 檢查粉專 token：<code>Type: Page</code>、<code>Expires: Never</code>、<code>Is Valid: True</code>。</li>
  <li>貼進 ShrineFlow，儲存後測試；成功必須顯示粉專名稱。</li>
</ol>
```

常見踩雷新增：

```html
<li><code>Tried accessing nonexisting field (accounts) on node type (Page)</code> → 目前用 Page token 跑 <code>me/accounts</code>；切回延伸後 User token。</li>
<li>Token 出現在截圖或公開紀錄 → 視為已洩漏，重新產生並替換。</li>
```

- [ ] **Step 3: 同步版本**

將 `package.json` version 及 `public/index.html` 的 `/style.css?v=`、`/app.js?v=` 改為 `0.6.21`。

- [ ] **Step 4: 執行精準驗證**

Run: `node --test test/help-articles.test.js test/help-search.test.js`

Expected: 所有測試 PASS。

- [ ] **Step 5: 檢查變更範圍**

Run: `git diff --check`

Expected: 無 whitespace error。不得提交或覆蓋其他工作樹修改。
