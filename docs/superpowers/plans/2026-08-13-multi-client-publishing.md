# Multi-Client Multi-Target Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 骨架——代操多客戶、一則貼文多發布目標（文案／格式／時間可異）、編輯一次一帳號；僅 Facebook target 真發布。

**Architecture:** `clients.json` 存客戶與帳號憑證；`posts.json` 的每則貼文含 `targets[]`；排程以 target 為唯一真相；scheduler／publish 依客戶帳號憑證建 Facebook publisher；前端頂欄切客戶，編輯預覽以 active target 切換。

**Tech Stack:** Node.js ESM、Express 5、本機 JSON（`lib/store.js`）、`node:test`、靜態 HTML/CSS/JS（`public/`）。

**Spec:** `docs/superpowers/specs/2026-08-13-multi-client-publishing-design.md`

## Global Constraints

- 前端維持 Express 靜態 HTML/CSS/JS，不重寫 React。
- UI 跟 `AGENTS.md` + `ui-ux-pro-max`（`.field`、`form-group-card`、`radio-pill-group`、觸控 44px、禁止水平捲軸、panel min-height）。
- Token 不回傳明文；API 用 `maskKey` 遮罩。
- Phase 1 非 FB 平台：可建帳號／預覽／排程欄位；到期標 `skipped_unsupported`，不可標 `published`。
- 版號：改完重要功能後同步 `package.json` version、`/api/config`、前端 `?v=`。
- Git：依 `AGENTS.md`，**僅在使用者下 `commit` 時 commit**（計畫步驟若寫 Commit，改為「暫存變更，等使用者 commit」）。
- 測試：改後端模組只跑對應 `node --test test/<file>.test.js`。

## File Map

| File | Responsibility |
| --- | --- |
| `lib/store.js` | 新增 `jsonFiles.clients`；`initStorage` 確保 `clients.json` |
| `lib/clients.js` | 客戶／帳號 CRUD、遮罩、自 `.env` 遷移預設客戶 |
| `lib/post-targets.js` | target 正規化、貼文彙總 status、舊貼文／舊排程遷移 |
| `lib/publishers/facebook.js` 或沿用 `lib/facebook.js` | 依帳號憑證建立 publisher（factory 可接受 pageId/token） |
| `lib/scheduler.js` | 掃 `posts.targets` 到期項；非 FB → skipped_unsupported |
| `lib/routes/clients.js` | `/api/clients` CRUD、帳號、連線測試 |
| `lib/routes/posts.js` | 依 `clientId` 過濾；接受 `targets` |
| `lib/routes/schedule.js` / `publish.js` | 改為 target 導向 |
| `lib/routes/config.js` | 回傳 clients 摘要；accounts 改依 query `clientId` |
| `server.js` | 掛 clients router；服務初始化可讀客戶帳號 |
| `public/*` | 客戶切換、設定頁客戶帳號、編輯預覽 targets |
| `test/clients.test.js` | 新建 |
| `test/post-targets.test.js` | 新建 |

---

### Task 1: Store + clients 模組（TDD）

**Files:**
- Modify: `lib/store.js`
- Create: `lib/clients.js`
- Create: `test/clients.test.js`

**Interfaces:**
- Produces:
  - `jsonFiles.clients` → `data/clients.json`
  - `listClients()` → `Promise<Client[]>`（帳號 credentials 已遮罩）
  - `listClientsRaw()` → `Promise<Client[]>`（含明文，僅內部）
  - `getClientRaw(clientId)` → `Promise<Client|null>`
  - `createClient({ name, notes? })` → `Promise<Client>`（遮罩版）
  - `updateClient(clientId, { name?, notes? })` → `Promise<Client|null>`
  - `upsertAccount(clientId, account)` → `Promise<Client|null>`（account 含 platformId、name、credentials；id 預設 `${platformId}:${pageId|makeId()}`）
  - `maskClient(client)` → 回傳 credentials 遮罩後的 client
  - `ensureDefaultClientFromEnv()` → 若無客戶且 env 有 FB，建立「預設客戶」＋ FB 帳號；若已有客戶則 no-op
  - `findAccount(client, accountId)` → account | null

- [ ] **Step 1: 寫失敗測試**

建立 `test/clients.test.js`：使用暫存目錄測 clients（可在測試內 mock `jsonFiles` 困難時，改測純函式 `maskClient`／`buildDefaultClientFromEnv` 先抽純函式）。

最小可測純函式優先放 `lib/clients.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskClient,
  buildDefaultClientFromEnv,
  summarizePostStatus,
} from '../lib/clients.js';
// summarizePostStatus 若放 post-targets 則本 task 不測它

test('maskClient hides pageAccessToken', () => {
  const masked = maskClient({
    id: 'c1',
    name: 'A',
    accounts: [{
      id: 'facebook:1',
      platformId: 'facebook',
      name: 'Page',
      enabled: true,
      configured: true,
      credentials: { pageId: '1', pageAccessToken: 'abcdefghijklmnop' },
    }],
  });
  assert.equal(masked.accounts[0].credentials.pageAccessToken.includes('...'), true);
  assert.equal(masked.accounts[0].credentials.pageId, '1');
});

test('buildDefaultClientFromEnv creates facebook account when env set', () => {
  const client = buildDefaultClientFromEnv({
    FACEBOOK_PAGE_ID: '999',
    FACEBOOK_PAGE_ACCESS_TOKEN: 'token-value-here',
  }, () => 'fixed-id');
  assert.equal(client.name, '預設客戶');
  assert.equal(client.accounts[0].id, 'facebook:999');
  assert.equal(client.accounts[0].configured, true);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/clients.test.js`  
Expected: FAIL（module / export 不存在）

- [ ] **Step 3: 實作 `lib/store.js` 與 `lib/clients.js`**

`lib/store.js` 增加：

```js
clients: path.join(directories.data, 'clients.json'),
```

`initStorage` 內：`await ensureJsonFile(jsonFiles.clients, []);`

`lib/clients.js` 實作 `maskClient`、`buildDefaultClientFromEnv`、`ensureDefaultClientFromEnv`（讀 raw clients，空則寫入）、CRUD 用 `mutateJson(jsonFiles.clients, ...)`。

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/clients.test.js`  
Expected: PASS

- [ ] **Step 5: 暫存，等使用者 commit**（勿自動 commit）

---

### Task 2: post-targets 正規化與遷移（TDD）

**Files:**
- Create: `lib/post-targets.js`
- Create: `test/post-targets.test.js`

**Interfaces:**
- Consumes: `makeId` from `store.js`
- Produces:
  - `normalizeTarget(raw, defaults?)` → target object with required fields
  - `summarizePostStatus(targets)` → `'draft'|'scheduled'|'published'|'failed'`（依規格表）
  - `migrateLegacyPost(post, defaultClientId)` → post with `clientId` + `targets[]`（自 channel/accountId/contentType/contentSettings 與可選 schedule 欄位）
  - `resolveTargetCopy(post, target)` → 字串（override 或母稿 facebook/reel）
  - `resolveTargetMedia(post, target)` → paths 陣列

- [ ] **Step 1: 寫失敗測試**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePostStatus, migrateLegacyPost, resolveTargetCopy } from '../lib/post-targets.js';

test('summarizePostStatus: any scheduled wins over draft', () => {
  assert.equal(summarizePostStatus([
    { status: 'draft' },
    { status: 'scheduled' },
  ]), 'scheduled');
});

test('summarizePostStatus: all published', () => {
  assert.equal(summarizePostStatus([
    { status: 'published' },
    { status: 'published' },
  ]), 'published');
});

test('migrateLegacyPost wraps channel into single target', () => {
  const migrated = migrateLegacyPost({
    id: 'p1',
    channel: 'facebook',
    accountId: 'facebook:1',
    contentType: 'post',
    contentSettings: { layout: 'auto' },
    status: 'draft',
    facebook: 'hello',
  }, 'client_default');
  assert.equal(migrated.clientId, 'client_default');
  assert.equal(migrated.targets.length, 1);
  assert.equal(migrated.targets[0].platformId, 'facebook');
  assert.equal(migrated.targets[0].accountId, 'facebook:1');
});

test('resolveTargetCopy uses override when set', () => {
  const copy = resolveTargetCopy(
    { facebook: '母稿', reel: '' },
    { contentType: 'post', copyOverride: '覆寫' },
  );
  assert.equal(copy, '覆寫');
});
```

- [ ] **Step 2: 跑測失敗** → `node --test test/post-targets.test.js`

- [ ] **Step 3: 實作 `lib/post-targets.js`**（狀態規則嚴格照規格 §5.4）

- [ ] **Step 4: 跑測通過**

- [ ] **Step 5: 暫存，等 commit**

---

### Task 3: Clients API + 啟動遷移

**Files:**
- Create: `lib/routes/clients.js`
- Modify: `server.js`
- Modify: `lib/routes/config.js`（可選：列出 clients 摘要）

**Interfaces:**
- `GET /api/clients` → 遮罩列表
- `POST /api/clients` body `{ name, notes? }`
- `PATCH /api/clients/:clientId` body `{ name?, notes? }`
- `PUT /api/clients/:clientId/accounts` body account（含 credentials；遮罩回傳）
- `POST /api/clients/:clientId/accounts/:accountId/test` → FB verify（用 raw credentials）
- 啟動時 `await ensureDefaultClientFromEnv()`

- [ ] **Step 1: 實作 router 並掛上 `server.js`（在 `/api`）**
- [ ] **Step 2: 手動或用小測試打 list／create（若無 integration test，至少 node 內 import 不炸）**
- [ ] **Step 3: `config` 增加 `clients: await listClients()` 或同步讀取**（注意 config 目前同步；可改 async handler）

```js
router.get('/config', async (_request, response) => {
  const { listClients } = await import('../clients.js');
  const clients = await listClients();
  response.json({ /* 既有欄位 */, clients });
});
```

- [ ] **Step 4: 暫存，等 commit**

---

### Task 4: Posts API 支援 clientId + targets

**Files:**
- Modify: `lib/routes/posts.js`
- Modify: 既有呼叫端若有（generate 存稿路徑）

**行為:**
- `GET /api/posts?clientId=` 必填或強烈建議；無則回全部但前端必傳
- `POST /api/posts` 需 `clientId`；可帶 `targets[]`；若無 targets 且有舊欄位 channel/accountId，用 `migrateLegacyPost` 形狀建立單一 target
- `PATCH /api/posts/:id` 可更新 targets；每次寫入後 `status = summarizePostStatus(targets)`
- 回傳前 `normalizePostCopy`

- [ ] **Step 1: 更新 posts router**
- [ ] **Step 2: 跑 `node --test test/post-targets.test.js test/clients.test.js`**
- [ ] **Step 3: 暫存，等 commit**

---

### Task 5: Scheduler + Publish 改 target 導向

**Files:**
- Modify: `lib/scheduler.js`
- Modify: `lib/routes/publish.js`
- Modify: `lib/routes/schedule.js`
- Modify: `server.js`（publisher 改為 factory：依帳號建）

**行為:**
- `claimDueTarget(now)`：在 `mutateJson(posts)` 找第一個 `status in pending|scheduled|retrying` 且 due 的 **facebook** target；標 `publishing`、attempts++
- 非 facebook 到期：標 `skipped_unsupported` + lastError 訊息「尚未支援」
- 發布時：`getClientRaw` → `findAccount` → `createFacebookPublisher(credentials)` → publish（文案／媒體用 resolveTarget*）
- `POST /api/publish/target` body `{ postId, targetId }`（保留舊 `/publish/facebook` 轉呼叫單一 FB target 以相容）
- 排程 API：寫入／取消改更新 target 的 `scheduledAt`／status；可逐步停寫 `schedule.json`（遷移：啟動時把 schedule.json pending 項 merge 進對應 post target）

- [ ] **Step 1: 實作 scheduler 新邏輯**
- [ ] **Step 2: 更新 publish／schedule routes**
- [ ] **Step 3: 跑 `node --test test/facebook.test.js`（若因 publisher 建構方式壞掉則修）**
- [ ] **Step 4: 暫存，等 commit**

---

### Task 6: 前端 — 客戶切換與設定帳號

**Files:**
- Modify: `public/index.html`（頂欄客戶 select／pill、設定區客戶帳號表單）
- Modify: `public/modules/state.js`、`api.js`、`settings.js`、`app.js`
- Modify: `public/style.css`（必要最小樣式）
- 遞增 `?v=` 與 `package.json` version（例如 `0.3.0`）

**行為:**
- 啟動載入 `/api/clients`；`localStorage.currentClientId`
- 頂欄切換客戶 → 重載 drafts／schedule／accounts
- 設定頁：當前客戶新增 FB 帳號（pageId + token）、測試連線；IG／LINE 可建名稱但標未連接

- [ ] **Step 1: HTML 結構（field／form-group-card）**
- [ ] **Step 2: JS API + state**
- [ ] **Step 3: 瀏覽器手動：切客戶、建帳號（開發者自測 checklist）**
- [ ] **Step 4: 版號同步**
- [ ] **Step 5: 暫存，等 commit**

---

### Task 7: 前端 — 編輯預覽多目標

**Files:**
- Modify: `public/index.html`、`public/modules/editor.js`、`platform-ui.js`、`drafts.js`、`schedule.js`、`app.js`

**行為:**
- 編輯區：目標帳號勾選（來自當前客戶 accounts）
- `activeTargetId`：一次只顯示該 target 文案／contentType／scheduledAt／預覽版型
- 存檔 PATCH 整份 `targets`
- 草稿列表顯示客戶內貼文；排程列表 flatten 為 target 列（帳號名、時間、狀態）
- 產生文案／存草稿帶 `clientId`；預設至少一個 FB target（若客戶有 FB 帳號）

- [ ] **Step 1: UI 勾選＋單目標編輯**
- [ ] **Step 2: 串存檔／排程**
- [ ] **Step 3: 版號 `?v=` bump**
- [ ] **Step 4: 暫存，等 commit**

---

### Task 8: 文件與回歸

**Files:**
- Modify: `PROJECT_STATUS.md`、`README.md`（多客戶說明）
- Modify: spec 狀態改「已核准／實作中」可選

- [ ] **Step 1: 更新 README／PROJECT_STATUS 已完成項**
- [ ] **Step 2: 跑 `node --test test/clients.test.js test/post-targets.test.js test/facebook.test.js test/platforms.test.js test/platform-accounts.test.js test/settings.test.js`**
- [ ] **Step 3: 回報使用者可 `commit`**

---

## Spec coverage self-check

| Spec 要求 | Task |
| --- | --- |
| 代操多客戶 JSON | 1, 3, 6 |
| 一則貼文多 targets、文案／時間可異 | 2, 4, 7 |
| 編輯一次一帳號 | 7 |
| 排程掛 target、同時／錯開 | 5, 7 |
| 僅 FB 真發；其他 skipped | 5 |
| Token 遮罩 | 1, 3 |
| 舊資料遷移 | 1（env→客戶）, 2（legacy post）, 5（schedule merge） |
| UI 規範／非 React | 6, 7 Global Constraints |
| 無登入／無 IG 真發 | 刻意不做 |

## Placeholder scan

無 TBD；Commit 步驟改為等使用者指令以符合 AGENTS.md。
