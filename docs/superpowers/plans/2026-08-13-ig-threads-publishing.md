# Instagram／Threads Publishing + Remove LINE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 LINE；讓 Instagram（feed／reel／story）與 Threads（post）可立刻發布與本機排程；媒體經 `PUBLIC_MEDIA_BASE_URL` 供 Meta 拉取；FB 原生排程行為不變。

**Architecture:** 獨立 `createInstagramPublisher`／`createThreadsPublisher`（container → publish）。IG／Threads 排程只寫本機 `scheduled`，由 `scheduler` 到期真發。憑證存在客戶 `accounts[].credentials`（對齊 FB）；全站存 `PUBLIC_MEDIA_BASE_URL`。

**Tech Stack:** Node.js ESM、Express、Meta Graph／Threads Graph `fetch`、本機 JSON、`node:test`、靜態 HTML/CSS/JS。

**Spec:** `docs/superpowers/specs/2026-08-13-ig-threads-publishing-design.md`

## Global Constraints

- 前端維持 Express 靜態 HTML/CSS/JS，不重寫 React。
- UI 跟 `AGENTS.md` + `ui-ux-pro-max`（`.field`、`form-group-card`、觸控 44px、禁止水平捲軸、panel min-height）。
- FB `scheduled`＋`externalId`＝平台佇列；IG／Threads `scheduled`＝等本機到期真發（可無 `externalId`）。
- IG／Threads **不**預建 Meta container（約 24h 過期）。
- 有媒體且無 `PUBLIC_MEDIA_BASE_URL` → 400，中文提示。
- 本機 scheduler **仍略過** FB＋`externalId` 的 scheduled（防雙發）。
- 版號：完成後 `package.json` `0.3.7` → `0.3.8`，同步 `/api/config` 與前端 `?v=`。
- Git：依 `AGENTS.md`，**僅在使用者下 `commit` 時 commit**（下列 Commit 步驟改為「暫存變更，等使用者 commit」）。
- 測試：只跑對應 `node --test test/<file>.test.js`。

## File Map

| File | Responsibility |
| --- | --- |
| `lib/platforms.js` | 移除 line；`getPublishingPlatforms({ facebookConfigured, instagramConfigured, threadsConfigured })` |
| `lib/platform-accounts.js` | 移除 line；IG／Threads 可 enabled／configured |
| `lib/media-public-url.js` | 新建：組公開媒體 URL |
| `lib/instagram.js` | 新建：IG publisher |
| `lib/threads.js` | 新建：Threads publisher |
| `lib/schedule-policy.js` | 本機排程最短緩衝（≥1 分鐘） |
| `lib/clients.js` | IG／Threads credentials 正規化／masked merge／configured |
| `lib/routes/clients.js` | test 端點支援 IG／Threads |
| `lib/routes/publish.js` | 依 platformId 分派 |
| `lib/routes/schedule.js` | FB 原生；IG／Threads 本機寫入 |
| `lib/scheduler.js` | IG／Threads 到期真發；停寫 `skipped_unsupported` |
| `lib/settings.js`＋`lib/routes/settings.js` | `PUBLIC_MEDIA_BASE_URL` |
| `server.js` | 注入 publishers／platforms flags |
| `public/index.html` | 砍 LINE；IG／Threads 客戶憑證欄；BASE URL；`?v=` |
| `public/modules/clients-ui.js`／`settings.js`／`state.js`／`schedule.js` | UI 配線與文案 |
| `package.json` | version `0.3.8` |
| `test/platforms.test.js`／`platform-accounts.test.js` | 無 line |
| `test/media-public-url.test.js` | 新建 |
| `test/instagram.test.js`／`threads.test.js` | 新建 |
| `test/scheduler-native.test.js` 或擴充 | IG／Threads 到期發 |

---

### Task 1: 移除 LINE（平台／帳號／UI）

**Files:**
- Modify: `lib/platforms.js`
- Modify: `lib/platform-accounts.js`
- Modify: `public/modules/state.js`
- Modify: `public/modules/clients-ui.js`
- Modify: `public/index.html`（其他平台區塊先刪 LINE 欄；完整 IG 憑證在 Task 5）
- Modify: `test/platforms.test.js`
- Modify: `test/platform-accounts.test.js`

**Interfaces:**
- Produces: `PLATFORM_DEFINITIONS` 僅 `facebook`／`instagram`／`threads`；`getPlatformAccounts` 無 `line:default`
- Consumes: 無

- [ ] **Step 1: 改失敗測試**

`test/platforms.test.js`：

```js
test('exposes facebook, instagram, threads without line', () => {
  const platforms = getPublishingPlatforms(false);
  assert.deepEqual(platforms.map((p) => p.id), ['facebook', 'instagram', 'threads']);
  assert.ok(!platforms.some((p) => p.id === 'line'));
});
```

`test/platform-accounts.test.js`：斷言 accounts 不含 `line:default`。

- [ ] **Step 2: 跑測確認失敗**

Run: `node --test test/platforms.test.js test/platform-accounts.test.js`  
Expected: FAIL（仍含 `line`）

- [ ] **Step 3: 最小實作**

從 `lib/platforms.js` 刪除 `line` 物件。  
從 `lib/platform-accounts.js` 刪除 line 帳號。  
`public/modules/state.js`：刪 `line` 名稱／描述。  
`public/index.html`：刪 `placeholderLineName` 欄。  
`public/modules/clients-ui.js`：刪 line 讀寫與 `btnSavePlaceholderAccounts` 內 line 分支（若整顆預留卡之後 Task 5 重做，此步至少不再寫 `platformId: 'line'`）。

- [ ] **Step 4: 跑測確認通過**

Run: `node --test test/platforms.test.js test/platform-accounts.test.js`  
Expected: PASS

- [ ] **Step 5: 暫存（等使用者 commit）**

```bash
git add lib/platforms.js lib/platform-accounts.js public/modules/state.js public/modules/clients-ui.js public/index.html test/platforms.test.js test/platform-accounts.test.js
```

---

### Task 2: `media-public-url` 輔助模組（TDD）

**Files:**
- Create: `lib/media-public-url.js`
- Create: `test/media-public-url.test.js`

**Interfaces:**
- Produces:
  - `resolvePublicMediaUrl(webPath, baseUrl = process.env.PUBLIC_MEDIA_BASE_URL)` → `string`
  - `resolvePublicMediaUrls(webPaths, baseUrl)` → `string[]`
  - 缺 base 或 path 非 `/uploads/` → throw `Error`（訊息含「PUBLIC_MEDIA_BASE_URL」或「公開網址」）
- Consumes: 無

- [ ] **Step 1: 寫失敗測試**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicMediaUrl } from '../lib/media-public-url.js';

test('joins PUBLIC_MEDIA_BASE_URL with upload path', () => {
  assert.equal(
    resolvePublicMediaUrl('/uploads/a.jpg', 'https://tunnel.example'),
    'https://tunnel.example/uploads/a.jpg',
  );
});

test('rejects missing base url', () => {
  assert.throws(() => resolvePublicMediaUrl('/uploads/a.jpg', ''), /PUBLIC_MEDIA_BASE_URL|公開/);
});

test('strips trailing slash on base', () => {
  assert.equal(
    resolvePublicMediaUrl('/uploads/a.jpg', 'https://tunnel.example/'),
    'https://tunnel.example/uploads/a.jpg',
  );
});
```

- [ ] **Step 2: 跑測確認失敗**

Run: `node --test test/media-public-url.test.js`  
Expected: FAIL（模組不存在）

- [ ] **Step 3: 最小實作**

```js
export function resolvePublicMediaUrl(webPath, baseUrl = process.env.PUBLIC_MEDIA_BASE_URL) {
  const path = String(webPath || '').trim();
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!base) {
    throw new Error('尚未設定 PUBLIC_MEDIA_BASE_URL。有媒體時請填公網或 tunnel 網址。');
  }
  if (!path.startsWith('/uploads/')) {
    throw new Error('媒體路徑無效，僅支援 /uploads/ 下的檔案。');
  }
  return `${base}${path}`;
}

export function resolvePublicMediaUrls(webPaths = [], baseUrl) {
  return webPaths.map((p) => resolvePublicMediaUrl(p, baseUrl));
}
```

- [ ] **Step 4: 跑測確認通過**

Run: `node --test test/media-public-url.test.js`  
Expected: PASS

- [ ] **Step 5: 暫存（等使用者 commit）**

```bash
git add lib/media-public-url.js test/media-public-url.test.js
```

---

### Task 3: Instagram publisher（TDD）

**Files:**
- Create: `lib/instagram.js`
- Create: `test/instagram.test.js`

**Interfaces:**
- Produces:
  - `InstagramPublishError`（`message`, 可選 `retriable`, `code`）
  - `createInstagramPublisher({ userId, accessToken, graphVersion, graphBaseUrl, fetchImpl, publicMediaBaseUrl, sleepImpl })`
  - `publisher.configured` → boolean
  - `publisher.verify()` → `Promise<{ id, username? }>`（`GET /{userId}?fields=id,username`）
  - `publisher.publish(post, { contentType, contentSettings, mediaWebPaths })` → `Promise<{ externalId, scheduled?: false }>`
    - `mediaWebPaths`：`/uploads/...` 陣列（用 `resolvePublicMediaUrls`）
    - `contentType`: `feed`｜`reel`｜`story`
    - caption：`post.facebook` 或 target copy 由呼叫端寫入 `post.facebook`／約定欄位；publisher 讀 `post.facebook`（feed／story 可空）與 `post.reel`（reel）
- Consumes: `resolvePublicMediaUrls` from `lib/media-public-url.js`

**行為細節（實作必須遵守）：**
- feed 單圖：`POST /{userId}/media` with `image_url`＋`caption` → poll → `media_publish`
- feed 多圖：每張 `is_carousel_item=true` → 父 `media_type=CAROUSEL`＋`children` → publish
- feed／reel 單影：`media_type=REELS` 或 `VIDEO`（Reel 用 `REELS`＋`caption`）；story 用 `media_type=STORIES`
- poll：`GET /{creationId}?fields=status_code` 直到 `FINISHED`；`ERROR`／逾時（預設最多約 60s，測試可注入 `sleepImpl` 與較短上限）→ throw
- 缺媒體（feed／reel／story 皆需至少一媒體；story 恰一）→ throw 中文
- 缺 `publicMediaBaseUrl`／env → throw（經 media-public-url）

- [ ] **Step 1: 寫失敗測試（節錄，實作檔須含齊）**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramPublisher } from '../lib/instagram.js';

test('publishes a single-image feed post via container then media_publish', async () => {
  const calls = [];
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    publicMediaBaseUrl: 'https://tunnel.example',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      const u = String(url);
      calls.push({ u, method: options.method || 'GET', body: options.body });
      if (u.includes('/ig-1/media') && !u.includes('media_publish')) {
        return new Response(JSON.stringify({ id: 'container-1' }), { status: 200 });
      }
      if (u.includes('container-1') && u.includes('status_code')) {
        return new Response(JSON.stringify({ status_code: 'FINISHED' }), { status: 200 });
      }
      if (u.includes('media_publish')) {
        return new Response(JSON.stringify({ id: 'media-9' }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    },
  });
  const result = await publisher.publish(
    { facebook: '你好' },
    { contentType: 'feed', mediaWebPaths: ['/uploads/a.jpg'] },
  );
  assert.equal(result.externalId, 'media-9');
  assert.ok(calls.some((c) => c.u.includes('media_publish')));
});

test('rejects publish when public media base is missing', async () => {
  const publisher = createInstagramPublisher({
    userId: 'ig-1',
    accessToken: 'token',
    publicMediaBaseUrl: '',
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  await assert.rejects(
    () => publisher.publish({ facebook: 'x' }, { contentType: 'feed', mediaWebPaths: ['/uploads/a.jpg'] }),
    /PUBLIC_MEDIA_BASE_URL|公開/,
  );
});
```

另加：`verify` 打對 URL；reel／story 至少各一則 mock 測（可同檔）。

- [ ] **Step 2: 跑測確認失敗**

Run: `node --test test/instagram.test.js`  
Expected: FAIL

- [ ] **Step 3: 最小實作 `lib/instagram.js`**

對齊 `lib/facebook.js` 風格：`graphRequest`、Bearer token、錯誤包裝。Graph base 預設 `https://graph.facebook.com`＋`META_GRAPH_VERSION`。

- [ ] **Step 4: 跑測確認通過**

Run: `node --test test/instagram.test.js`  
Expected: PASS

- [ ] **Step 5: 暫存（等使用者 commit）**

```bash
git add lib/instagram.js test/instagram.test.js
```

---

### Task 4: Threads publisher（TDD）

**Files:**
- Create: `lib/threads.js`
- Create: `test/threads.test.js`

**Interfaces:**
- Produces:
  - `ThreadsPublishError`
  - `createThreadsPublisher({ userId, accessToken, graphVersion = 'v1.0', graphBaseUrl = 'https://graph.threads.net', fetchImpl, publicMediaBaseUrl, sleepImpl })`
  - `publisher.configured`、`verify()`（`GET /{userId}?fields=id,username`）、`publish(post, { mediaWebPaths })`
  - 文字：`post.facebook`（或呼叫端已解析之 copy）→ `media_type=TEXT`
  - 單圖／單影：`IMAGE`／`VIDEO`＋對應 url；無媒體＝TEXT
  - 有媒體無 BASE → throw
- Consumes: `resolvePublicMediaUrls`

- [ ] **Step 1: 寫失敗測試**

```js
test('publishes text-only threads post', async () => {
  const calls = [];
  const publisher = createThreadsPublisher({
    userId: 'th-1',
    accessToken: 'token',
    sleepImpl: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).includes('/threads_publish')) {
        return new Response(JSON.stringify({ id: 'thr-9' }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: 'container-t' }), { status: 200 });
    },
  });
  const result = await publisher.publish({ facebook: '純文字' }, { mediaWebPaths: [] });
  assert.equal(result.externalId, 'thr-9');
  assert.ok(calls.some((u) => u.includes('threads_publish')));
});
```

另測：有圖需 BASE；`verify`。

- [ ] **Step 2–4:** 同 Task 3 模式：FAIL → 實作 → PASS

- [ ] **Step 5: 暫存（等使用者 commit）**

```bash
git add lib/threads.js test/threads.test.js
```

---

### Task 5: 設定／客戶帳號 — IG／Threads 憑證＋`PUBLIC_MEDIA_BASE_URL`

**Files:**
- Modify: `lib/settings.js`（`PUBLIC_MEDIA_BASE_URL` 進 format／save／getPublic）
- Modify: `lib/routes/settings.js`（POST 接受該欄）
- Modify: `lib/clients.js`（`userId`＋`accessToken` merge／mask；IG／Threads `configured = userId && accessToken`）
- Modify: `lib/routes/clients.js`（test 分支 IG／Threads）
- Modify: `public/index.html`（替換「其他平台即將支援」為 IG／Threads 憑證 fieldset＋全站 BASE）
- Modify: `public/modules/clients-ui.js`／`settings.js`
- Modify: `test/settings.test.js`（若有 formatEnv 斷言則更新）

**Interfaces:**
- Produces: 客戶帳號可存 `{ userId, accessToken }`；`POST .../test` 對 IG／Threads 呼叫對應 `verify()`
- Consumes: `createInstagramPublisher`／`createThreadsPublisher`

- [ ] **Step 1: 擴充 `normalizeAccountInput`／mask**

- `accessToken` 含 `...` 時保留舊值（同 `pageAccessToken`）
- facebook：維持 `pageId`＋`pageAccessToken`
- instagram／threads：`configured = Boolean(userId && accessToken)`；`id` 可用 `instagram:${userId}`／`threads:${userId}`

- [ ] **Step 2: 設定頁 HTML**

用兩個 `form-group-card`：
1. Instagram（userId、accessToken、儲存、測連線）— 對齊 FB 的 `.field`／`.field-label` 結構  
2. Threads（同上）  
3. 全站：`PUBLIC_MEDIA_BASE_URL` 放在 Meta API disclosure 旁或獨立小卡；存進 `/api/settings`（與 Gemini／graph version 一起或獨立儲存鈕皆可，建議併入「儲存 Gemini／全站設定」或明確「儲存全站媒體網址」）

刪除 placeholder 預留卡與 `btnSavePlaceholderAccounts`。

- [ ] **Step 3: clients-ui 存檔／載入**

對齊 `btnSaveClientFacebook`：`PUT /api/clients/:id/accounts` with `platformId: 'instagram'|'threads'`。

- [ ] **Step 4: test 路由**

```js
if (account.platformId === 'instagram') { /* createInstagramPublisher + verify */ }
if (account.platformId === 'threads') { /* createThreadsPublisher + verify */ }
```

- [ ] **Step 5: 跑相關測**

Run: `node --test test/settings.test.js`（若有）  
手動：設定頁欄位存在、無 LINE。

- [ ] **Step 6: 暫存（等使用者 commit）**

---

### Task 6: Publish 路由分派 IG／Threads

**Files:**
- Modify: `lib/routes/publish.js`
- Modify: `server.js`（傳入 resolve publishers／env BASE）
- Create or Modify: `test/publish-multi.test.js`（mock publishers）

**Interfaces:**
- Produces: `publishTarget` 依 `target.platformId` 呼叫 FB／IG／Threads；成功寫 `published`＋`externalId`
- Consumes: 三個 publisher factory；`resolveTargetMedia` → web paths；IG／Threads 用 `mediaWebPaths` 而非僅 file paths

- [ ] **Step 1: 寫路由層測試**

Mock `createPublishRouter` 依賴：對 `platformId: 'instagram'` 的 POST 會呼叫 stub `publish` 且回 200；未設定 publisher → 503。

- [ ] **Step 2: 實作分派**

```js
// 概念
if (target.platformId === 'facebook') { /* 既有 */ }
else if (target.platformId === 'instagram') {
  const publisher = resolveInstagramPublisher(...);
  await publisher.publish(publishPost, {
    contentType: target.contentType || 'feed',
    contentSettings: target.contentSettings || {},
    mediaWebPaths: resolveTargetMedia(post, target),
  });
} else if (target.platformId === 'threads') {
  ...
} else {
  throw Object.assign(new Error('不支援的發布平台。'), { status: 400 });
}
```

- [ ] **Step 3: 跑測 PASS → 暫存**

---

### Task 7: 本機排程＋scheduler 支援 IG／Threads

**Files:**
- Modify: `lib/schedule-policy.js`
- Modify: `lib/routes/schedule.js`
- Modify: `lib/scheduler.js`
- Modify: `test/scheduler-native.test.js`（或新建 `test/scheduler-ig-threads.test.js`）
- Modify: `test/schedule-native.test.js`（追加本機排程案例）

**Interfaces:**
- Produces:
  - `assertLocalScheduleWindow(scheduledAt, now)` → Date；少於 1 分鐘 → throw／回錯誤字串
  - `POST /schedule`：`instagram`／`threads` **不**呼叫遠端排程；寫 `status: scheduled`、`externalId: null`
  - `PATCH`／`DELETE`：非 FB 只改本機
  - `claimDueTarget`：刪除「非 FB → skipped_unsupported」；改為 claim IG／Threads
  - `processDueSchedules`：依 platform 選 publisher；IG／Threads 傳 `mediaWebPaths`
- Consumes: publishers from Task 3–4

- [ ] **Step 1: schedule-policy**

```js
export function rejectLocalScheduleTooSoon(scheduledAt, now = new Date()) {
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return '排程時間格式不正確。';
  if (at.getTime() < now.getTime() + 60 * 1000) {
    return '排程時間須至少是 1 分鐘後。';
  }
  return null;
}

export function rejectScheduleContentType(platformId, contentType) {
  if (platformId === 'facebook' && contentType === 'story') {
    return 'Facebook 限時動態不支援原生排程，請改用貼文或 Reel。';
  }
  return null;
}
```

- [ ] **Step 2: 測試 — IG POST /schedule 不呼叫 publish**

Stub `resolveFacebookPublisher` 不應被 IG 呼叫；回應 `status: 'scheduled'`、`externalId: null`。

- [ ] **Step 3: 測試 — scheduler claim IG 並 publish**

`shouldClaimTargetForLocalPublish` 對 IG scheduled 到期回 true；`processDueSchedules` 呼叫 stub IG publisher。

- [ ] **Step 4: 實作 scheduler 分派**

```js
// claimDueTarget: 移除 non-facebook skipped_unsupported 區塊
// publisherForClaim: switch platformId
// publish options: facebook 用 mediaFilePaths；ig/threads 用 mediaWebPaths from resolveTargetMedia
```

`createScheduler` 簽名擴充：

```js
createScheduler({
  facebookPublisher,
  createPublisher = createFacebookPublisher,
  createInstagramPublisher,
  createThreadsPublisher,
  resolvePublicMediaBaseUrl = () => process.env.PUBLIC_MEDIA_BASE_URL || '',
})
```

- [ ] **Step 5: 跑測**

Run: `node --test test/schedule-native.test.js test/scheduler-native.test.js`（及新建檔）  
Expected: PASS（含既有 FB 不雙發）

- [ ] **Step 6: 暫存**

---

### Task 8: 平台啟用旗標、排程 UI 文案、版號

**Files:**
- Modify: `lib/platforms.js` — `getPublishingPlatforms` 改物件參數（相容：若傳 boolean 仍當 facebookConfigured）
- Modify: `lib/platform-accounts.js` — IG／Threads `enabled`／`configured` 依參數
- Modify: `server.js`／`lib/routes/config.js` — 傳入 configured flags；可選回傳 `publicMediaBaseUrlConfigured`
- Modify: `public/modules/schedule.js` — toast／說明：FB「交平台佇列」vs IG／Threads「本機到點發（需開著服務）」
- Modify: `public/modules/targets-ui.js` 或發布前檢查 — 有媒體且無 BASE 時提示
- Modify: `public/index.html` — `?v=0.3.8`
- Modify: `package.json` — `"version": "0.3.8"`
- Modify: `test/platforms.test.js`

**Interfaces:**
- Produces: 憑證齊時 IG／Threads 在 UI 可選且 `canPublish: true`

- [ ] **Step 1: 更新 getPublishingPlatforms**

```js
export function getPublishingPlatforms(facebookConfiguredOrOpts = false) {
  const opts = typeof facebookConfiguredOrOpts === 'boolean'
    ? { facebookConfigured: facebookConfiguredOrOpts }
    : (facebookConfiguredOrOpts || {});
  const {
    facebookConfigured = false,
    instagramConfigured = false,
    threadsConfigured = false,
  } = opts;
  return PLATFORM_DEFINITIONS.map((platform) => {
    const configured = platform.id === 'facebook' ? facebookConfigured
      : platform.id === 'instagram' ? instagramConfigured
        : platform.id === 'threads' ? threadsConfigured : false;
    return {
      ...platform,
      enabled: configured,
      configured,
      contentTypes: platform.contentTypes.map((ct) => ({
        ...ct,
        canPublish: platform.id === 'facebook' ? ct.canPublish : configured,
      })),
    };
  });
}
```

（FB contentTypes 維持既有 canPublish；IG／Threads 整平台隨 configured。）

- [ ] **Step 2: server 組裝**

任一客戶或 env 有完整 IG／Threads 憑證 → `instagramConfigured`／`threadsConfigured` true（實作可簡化：檢查 `process.env` fallback＋預設客戶 accounts，或「任一 client account configured」）。

- [ ] **Step 3: 排程 UI 文案**

在 `schedule.js` 確認成功 toast：  
- facebook：`已交 Facebook 排程佇列`  
- 其他：`已加入本機排程（到期時需服務運行中）`

- [ ] **Step 4: 版號 0.3.8**

- [ ] **Step 5: 跑測**

Run: `node --test test/platforms.test.js test/instagram.test.js test/threads.test.js test/media-public-url.test.js test/schedule-native.test.js test/scheduler-native.test.js`  
Expected: PASS

- [ ] **Step 6: 暫存；等使用者 `commit`**

---

## Self-Review (plan vs spec)

| Spec 要求 | Task |
| --- | --- |
| 移除 LINE | Task 1 |
| PUBLIC_MEDIA_BASE_URL | Task 2＋5 |
| IG feed／reel／story 真發 | Task 3＋6 |
| Threads post 真發 | Task 4＋6 |
| 本機排程／改時間／取消 | Task 7 |
| Scheduler 到期真發；FB 不雙發 | Task 7 |
| 設定／客戶憑證／測連線 | Task 5 |
| UI 文案差異＋版號 | Task 8 |
| 不預建 container | Task 7（只寫本機） |
| 非目標 OAuth／S3／原生 IG 排程 | 未列入 |

無 TBD。憑證主路徑改為**客戶帳號**（規格 6.1 已同步），與現有 FB UI 一致。
