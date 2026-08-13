# Facebook Native Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Facebook 貼文／Reel 的「排程」改為立刻呼叫 Graph 原生排程佇列；改時間／取消同步 FB；限時禁止排程；停用本機對 FB 到期真發。

**Architecture:** `createFacebookPublisher` 的 `publish` 接受可選 `scheduledAt`，對 feed／photos／videos／Reel 帶 `published=false` + `scheduled_publish_time`（Reel 用 `video_state=SCHEDULED`）；新增 `deleteScheduled(externalId)`。`POST /api/schedule` 成功呼叫 Graph 後才寫 target `scheduled`＋`externalId`；新增 `PATCH`／`DELETE` 做改時間／取消。`scheduler.claimDueTarget` 略過已交 FB 原生排程的 target。

**Tech Stack:** Node.js ESM、Express、`lib/facebook.js` Graph fetch、本機 JSON posts、`node:test`、靜態 `public/modules/schedule.js`。

**Spec:** `docs/superpowers/specs/2026-08-13-facebook-native-scheduling-design.md`

## Global Constraints

- 前端維持 Express 靜態 HTML/CSS/JS，不重寫 React。
- UI 跟 `AGENTS.md` + `ui-ux-pro-max`（`.field`、`form-group-card`、觸控 44px、禁止水平捲軸、panel min-height）。
- `scheduled` 語意＝已在 FB 排程佇列（有 `externalId`），不是等本機發。
- 限時 `story`：排程 API／UI 禁止；立刻發布仍可用。
- 本機 `scheduler` 不得再對 FB `scheduled` target 到期呼叫立刻 `publish`（防雙重發布）。
- 版號：本功能完成後 bump `package.json`（現行 `0.3.6` → `0.3.7`），並同步 `/api/config` 與前端 `?v=`。
- Git：依 `AGENTS.md`，**僅在使用者下 `commit` 時 commit**（下列 Commit 步驟改為「暫存變更，等使用者 commit」）。
- 測試：只跑對應 `node --test test/<file>.test.js`。

## File Map

| File | Responsibility |
| --- | --- |
| `lib/facebook.js` | 排程時間窗驗證；`publish(..., { scheduledAt })`；`deleteScheduled(externalId)` |
| `lib/routes/schedule.js` | POST 立刻交 FB；PATCH 改時間；DELETE 取消；story 400 |
| `lib/scheduler.js` | 略過「已有 externalId 的 FB scheduled」到期真發 |
| `public/modules/schedule.js` | Toast 文案；限時禁排；改時間／取消按鈕 |
| `public/modules/targets-ui.js` / `platform-ui.js` | 限時時禁用排程欄／按鈕 |
| `public/index.html` | 排程卡操作鈕（若需）；`?v=` |
| `package.json` | version bump |
| `test/facebook.test.js` | 原生排程／刪除／時間窗 |
| `test/schedule-native.test.js` | 路由層 mock publisher（新建） |
| `test/scheduler.test.js` | 確認不雙發（新建或擴充） |
| `docs/superpowers/specs/2026-08-13-multi-client-publishing-design.md` | 一句交叉引用：FB 排程改原生（可選、簡短） |

---

### Task 1: Facebook publisher — 時間窗 + 原生排程參數（TDD）

**Files:**
- Modify: `lib/facebook.js`
- Modify: `test/facebook.test.js`

**Interfaces:**
- Produces:
  - `assertFacebookScheduleWindow(scheduledAt, now = new Date())` → 合規則回 `Date`；否則 throw `FacebookPublishError`（訊息含「至少 10 分鐘後」或「不可超過 6 個月」）
  - `publish(post, options)` 既有簽名擴充：`options.scheduledAt` 為 ISO 字串或 Date；有值則走排程模式
  - `deleteScheduled(externalId)` → `Promise<{ deleted: true, externalId }>`；對 `DELETE /{graphVersion}/{externalId}` 帶 Bearer
- Consumes: 既有 `graphRequest`／`mediaForm`／`publishFeedPost`／`publishReel`

- [ ] **Step 1: 寫失敗測試**

在 `test/facebook.test.js` 追加：

```js
import { assertFacebookScheduleWindow, createFacebookPublisher } from '../lib/facebook.js';

test('assertFacebookScheduleWindow rejects times sooner than 10 minutes', () => {
  const now = new Date('2026-08-13T12:00:00.000Z');
  assert.throws(
    () => assertFacebookScheduleWindow(new Date(now.getTime() + 5 * 60 * 1000).toISOString(), now),
    /10 分鐘/,
  );
});

test('schedules a text feed post with published=false and scheduled_publish_time', async () => {
  let body;
  const publisher = createFacebookPublisher({
    pageId: '12345',
    pageAccessToken: 'secret-token',
    fetchImpl: async (url, options) => {
      body = options.body;
      return new Response(JSON.stringify({ id: '12345_999' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const result = await publisher.publish(
    { facebook: '排程貼文' },
    { scheduledAt },
  );
  assert.equal(body.get('published'), 'false');
  assert.equal(body.get('scheduled_publish_time'), String(Math.floor(new Date(scheduledAt).getTime() / 1000)));
  assert.equal(result.externalId, '12345_999');
  assert.equal(result.scheduled, true);
});

test('deleteScheduled sends DELETE for the external id', async () => {
  let request;
  const publisher = createFacebookPublisher({
    pageId: '12345',
    pageAccessToken: 'secret-token',
    fetchImpl: async (url, options) => {
      request = { url: String(url), method: options.method };
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  await publisher.deleteScheduled('12345_999');
  assert.equal(request.method, 'DELETE');
  assert.match(request.url, /\/12345_999$/);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/facebook.test.js`  
Expected: 新測試 FAIL（`assertFacebookScheduleWindow` / `deleteScheduled` / body 無排程欄位）

- [ ] **Step 3: 最小實作**

在 `lib/facebook.js`：

```js
export function assertFacebookScheduleWindow(scheduledAt, now = new Date()) {
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) {
    throw new FacebookPublishError('排程時間格式不正確。');
  }
  const min = new Date(now.getTime() + 10 * 60 * 1000);
  const max = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  if (when < min) {
    throw new FacebookPublishError('Facebook 排程時間須至少在 10 分鐘之後。');
  }
  if (when > max) {
    throw new FacebookPublishError('Facebook 排程時間不可超過約 6 個月。');
  }
  return when;
}
```

在 `publishFeedPost`／單圖／多圖／影片路徑：若 `options.scheduledAt` 存在，先 `assertFacebookScheduleWindow`，unix 秒寫入：

- `feed`／最終多圖 `feed`：`published=false`、`scheduled_publish_time`
- 單圖 `photos`：同上
- 單影片 `videos`：同上  
（未公開上傳的 `published=false` 照片 ID 步驟維持；只在最終組貼加排程參數。）

`publishReel`：finish 步驟加 `video_state: 'SCHEDULED'`、`scheduled_publish_time`（unix）。

`publish` 開頭：若 `contentType === 'story'` 且有 `scheduledAt` → throw `FacebookPublishError('Facebook 限時動態不支援排程，請改用立刻發布。')`。

回傳物件加 `scheduled: Boolean(options.scheduledAt)`。

新增：

```js
async function deleteScheduled(externalId) {
  const id = String(externalId || '').trim();
  if (!id) throw new FacebookPublishError('缺少要取消的 Facebook 排程 ID。');
  await rawRequest(`${graphRoot}/${graphVersion}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { deleted: true, externalId: id };
}
```

`return { configured, publish, verify, deleteScheduled };`

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/facebook.test.js`  
Expected: PASS（含既有立刻發布測試：不帶 `scheduledAt` 時行為不變）

- [ ] **Step 5: 暫存變更，等使用者 commit**

```bash
git add lib/facebook.js test/facebook.test.js
# 等使用者下 commit 指令
```

---

### Task 2: Schedule 路由 — POST 立刻交 FB；story 拒絕（TDD）

**Files:**
- Modify: `lib/routes/schedule.js`
- Modify: `server.js`（若 router factory 需注入 `createPublisher`／`getPublisherForAccount`）
- Create: `test/schedule-native.test.js`

**Interfaces:**
- Consumes: Task 1 的 `publish(..., { scheduledAt, contentType, mediaFilePaths })`、`assertFacebookScheduleWindow`
- Produces:
  - `POST /api/schedule`：FB `post`／`reel` 成功後 target.`status='scheduled'`、`externalId`、`scheduledAt`；失敗不寫 scheduled
  - story → `400` `{ error: '...' }`
  - `createScheduleRouter({ publishingPlatforms, resolveFacebookPublisher })`  
    `resolveFacebookPublisher({ clientId, accountId })` → publisher | null

Helper（可放 `schedule.js` 或小函式檔）：從 post＋target 組 `publishPost`／`mediaFilePaths`（對齊 `scheduler.js` 既有邏輯，避免複製漂移——優先抽 `lib/publish-target.js` 的 `buildPublishPayload(post, target)` 若兩處都用；否則本 task 先內聯與 scheduler 相同片段，Task 3 再 DRY）。

- [ ] **Step 1: 寫失敗測試**

`test/schedule-native.test.js`（用暫存 data dir 或 mock `mutateJson` 困難時：測 router 搭配注入假 store 困難，則改測「純函式」`validateScheduleRequest`／整合式起小型 express——優先跟現有 route 測試風格）。

若專案尚無 route 整合測試，最小做法：抽出並測：

```js
// lib/schedule-policy.js
export function rejectScheduleContentType(platformId, contentType) {
  if (platformId === 'facebook' && contentType === 'story') {
    return 'Facebook 限時動態不支援排程，請改用立刻發布。';
  }
  return null;
}
```

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rejectScheduleContentType } from '../lib/schedule-policy.js';

test('rejects facebook story schedule', () => {
  assert.match(rejectScheduleContentType('facebook', 'story'), /限時動態/);
});
```

並加一則「假 publisher」單元測試檔測 orchestration 函式（建議抽出）：

```js
// lib/native-schedule.js
export async function scheduleFacebookTarget({
  publisher,
  post,
  target,
  scheduledAt,
  mediaFilePaths,
}) { ... }
```

測試：publisher.publish 被呼叫且帶 `scheduledAt`；回傳更新後的 target 欄位；publisher 丟錯則不回 scheduled 狀態物件。

- [ ] **Step 2: 跑測確認失敗**

Run: `node --test test/schedule-native.test.js`  
Expected: FAIL（模組不存在）

- [ ] **Step 3: 實作 policy + native-schedule + 接上 POST**

`lib/schedule-policy.js`：如上。

`lib/native-schedule.js`：

```js
export async function scheduleFacebookTarget({
  publisher,
  post,
  target,
  scheduledAt,
  mediaFilePaths,
  normalizePostCopy,
  resolveTargetCopy,
}) {
  if (!publisher?.configured) {
    throw new Error('Facebook 帳號尚未設定完整。');
  }
  const copy = resolveTargetCopy(post, target);
  const publishPost = normalizePostCopy({
    ...post,
    facebook: target.contentType === 'reel' ? post.facebook : copy,
    reel: target.contentType === 'reel' ? copy : post.reel,
  });
  const result = await publisher.publish(publishPost, {
    contentType: target.contentType || 'post',
    contentSettings: target.contentSettings || {},
    mediaFilePaths,
    scheduledAt,
  });
  return {
    scheduledAt: new Date(scheduledAt).toISOString(),
    status: 'scheduled',
    externalId: result.externalId,
    lastError: null,
  };
}
```

`POST /api/schedule` 流程：

1. 既有驗證  
2. `rejectScheduleContentType` → 有字串則 400  
3. FB：解析 publisher → `scheduleFacebookTarget` → **成功後** 才 `mutateJson` 寫入 target  
   （若必須先佔位：失敗時 rollback status／清 externalId；優先「先 Graph 成功再寫 JSON」）  
4. 非 FB：維持現況寫本機 scheduled／或明確 400「尚未支援原生排程」（Phase 1：非 FB 可仍只寫本機欄位但不真發——與多客戶規格一致時，寫本機即可且不呼叫 Graph）

`server.js` 注入 `resolveFacebookPublisher`（從 client 帳號建 `createFacebookPublisher`，fallback 全域 env publisher）。

- [ ] **Step 4: 跑測通過**

Run: `node --test test/schedule-native.test.js test/facebook.test.js`  
Expected: PASS

- [ ] **Step 5: 暫存，等 commit**

```bash
git add lib/schedule-policy.js lib/native-schedule.js lib/routes/schedule.js server.js test/schedule-native.test.js
```

---

### Task 3: PATCH 改時間 + DELETE 取消（同步 FB）

**Files:**
- Modify: `lib/routes/schedule.js`
- Modify: `lib/native-schedule.js`
- Modify: `test/schedule-native.test.js`

**Interfaces:**
- Produces:
  - `PATCH /api/schedule/:targetId` body `{ scheduledAt }` → 刪舊 `externalId`（若有）→ 新建排程 → 更新本機
  - `DELETE /api/schedule/:targetId` → 刪 FB → 本機 `status='draft'`、`scheduledAt=null`、`externalId=null`
  - `rescheduleFacebookTarget(...)` / `cancelFacebookTarget(...)`

- [ ] **Step 1: 寫失敗測試**

```js
test('reschedule deletes old external id then schedules again', async () => {
  const calls = [];
  const publisher = {
    configured: true,
    async deleteScheduled(id) { calls.push(['delete', id]); return { deleted: true, externalId: id }; },
    async publish() { calls.push(['publish']); return { externalId: 'new-id', scheduled: true }; },
  };
  const next = await rescheduleFacebookTarget({
    publisher,
    post: { facebook: 'x', reel: '', hashtags: [] },
    target: { contentType: 'post', contentSettings: {}, externalId: 'old-id' },
    scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    mediaFilePaths: [],
    normalizePostCopy: (p) => p,
    resolveTargetCopy: () => 'x',
  });
  assert.deepEqual(calls.map((c) => c[0]), ['delete', 'publish']);
  assert.equal(next.externalId, 'new-id');
});

test('cancel clears local schedule after deleteScheduled', async () => {
  const publisher = {
    async deleteScheduled(id) { return { deleted: true, externalId: id }; },
  };
  const next = await cancelFacebookTarget({
    publisher,
    target: { externalId: 'old-id', status: 'scheduled', scheduledAt: '2026-08-14T00:00:00.000Z' },
  });
  assert.equal(next.status, 'draft');
  assert.equal(next.scheduledAt, null);
  assert.equal(next.externalId, null);
});
```

- [ ] **Step 2: 跑測 FAIL**

Run: `node --test test/schedule-native.test.js`  
Expected: FAIL（函式未匯出）

- [ ] **Step 3: 實作**

```js
export async function rescheduleFacebookTarget(args) {
  const { publisher, target } = args;
  if (target.externalId) {
    await publisher.deleteScheduled(target.externalId);
  }
  return scheduleFacebookTarget(args);
}

export async function cancelFacebookTarget({ publisher, target }) {
  if (target.externalId) {
    if (!publisher?.configured && !publisher?.deleteScheduled) {
      throw new Error('無法取消：Facebook 帳號未設定。');
    }
    await publisher.deleteScheduled(target.externalId);
  }
  return {
    status: 'draft',
    scheduledAt: null,
    externalId: null,
    lastError: null,
  };
}
```

路由：依 `targetId` 找 post／target／client publisher；更新後 `post.status = summarizePostStatus(post.targets)`。

刪成功、建失敗：target `status='failed'`、`lastError.message` 說明可能需到粉專後台檢查；HTTP 502／500 回錯誤字串。

- [ ] **Step 4: 跑測 PASS**

Run: `node --test test/schedule-native.test.js`  
Expected: PASS

- [ ] **Step 5: 暫存，等 commit**

---

### Task 4: 停用本機對 FB 原生排程的到期真發

**Files:**
- Modify: `lib/scheduler.js`（`claimDueTarget`）
- Create: `test/scheduler-native.test.js`

**Interfaces:**
- 規則：若 `target.platformId === 'facebook'` 且 `target.status === 'scheduled'` 且 `target.externalId` → **skip**（已交 FB）
- 仍處理：無 `externalId` 的舊 `pending`／`retrying`／legacy `scheduled`（遷移殘留）可繼續本機發一次，或一次性標註需手動處理——**本計畫採：無 externalId 的 FB scheduled／pending／retrying 仍走舊本機發，避免卡死舊資料**

- [ ] **Step 1: 寫失敗測試**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldClaimTargetForLocalPublish } from '../lib/scheduler.js';

test('does not claim facebook scheduled targets that already have externalId', () => {
  assert.equal(
    shouldClaimTargetForLocalPublish({
      platformId: 'facebook',
      status: 'scheduled',
      externalId: '123_456',
      scheduledAt: '2020-01-01T00:00:00.000Z',
    }, new Date()),
    false,
  );
});

test('claims legacy facebook scheduled without externalId when due', () => {
  assert.equal(
    shouldClaimTargetForLocalPublish({
      platformId: 'facebook',
      status: 'scheduled',
      externalId: null,
      scheduledAt: '2020-01-01T00:00:00.000Z',
    }, new Date()),
    true,
  );
});
```

- [ ] **Step 2: FAIL → Step 3 抽出 `shouldClaimTargetForLocalPublish` 並在 `claimDueTarget` 使用 → Step 4 PASS**

```js
export function shouldClaimTargetForLocalPublish(target, now = new Date()) {
  if (!['scheduled', 'pending', 'retrying'].includes(target.status)) return false;
  if (target.platformId === 'facebook' && target.status === 'scheduled' && target.externalId) {
    return false;
  }
  const dueAt = target.status === 'retrying' ? target.nextAttemptAt : target.scheduledAt;
  if (!dueAt || new Date(dueAt) > now) return false;
  return true;
}
```

- [ ] **Step 5: 暫存，等 commit**

---

### Task 5: 前端 — 文案、限時禁排、改時間／取消

**Files:**
- Modify: `public/modules/schedule.js`
- Modify: `public/modules/platform-ui.js`（contentType change 時禁排程）
- Modify: `public/modules/targets-ui.js`（`#targetScheduledAt` 限時 disabled）
- Modify: `public/index.html`（排程卡按鈕；script `?v=`）
- Modify: `package.json` version `0.3.6` → `0.3.7`

**Interfaces:**
- Consumes: `POST /api/schedule`、`PATCH /api/schedule/:targetId`、`DELETE /api/schedule/:targetId`

- [ ] **Step 1: 更新成功 Toast**

成功文案改為：`已送進 Facebook 排程佇列，到點會由粉專自動公開。`（未連線則維持警告）

- [ ] **Step 2: 限時禁排**

- `#scheduleContentType` 為 `story` 時：`#scheduleSubmitButton` disabled＋說明文字  
- `#targetContentType` 為 `story` 時：清空並 disable `#targetScheduledAt`；主按鈕「排程發布」在僅限時時 disabled  
- `renderContentSettings`／change handler 同步

- [ ] **Step 3: 排程列表操作**

每張 `scheduled` 且 channel=facebook 的卡加兩個按鈕（觸控 ≥44px）：

- 「改時間」→ 小 dialog 或 `prompt` 避免過度複雜：用既有 `scheduleDialog` 預填，submit 改打 `PATCH`  
- 「取消」→ `confirm` 後 `DELETE`

```js
await api('/api/schedule/' + encodeURIComponent(item.targetId), {
  method: 'DELETE',
});
```

```js
await api('/api/schedule/' + encodeURIComponent(item.targetId), {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ scheduledAt: new Date(...).toISOString() }),
});
```

- [ ] **Step 4: 手動驗**

`start.bat` → 排程貼文（mock／真實粉專）→ 粉專後台「排程」可見；改時間／取消同步；限時無法排；關排程服務後到期仍應由 FB 公開（真帳號驗）。

- [ ] **Step 5: bump 版號 `0.3.7`，靜態資源 `?v=0.3.7`，暫存等 commit**

- [ ] **Step 6（可選）:** 多客戶規格加一句「FB 排程見 `2026-08-13-facebook-native-scheduling-design.md`」

---

## Spec coverage self-check

| Spec 要求 | Task |
| --- | --- |
| 排程立刻進 FB 佇列 | Task 1–2 |
| 改時間／取消同步 FB | Task 3、5 |
| 限時禁止排程 | Task 1（throw）、2（400）、5（UI） |
| 停用本機到期真發（有 externalId） | Task 4 |
| 時間窗 10 分～6 月 | Task 1 |
| 立刻發布不變 | Task 1 既有測試 |
| 雙重發布防護 | Task 4 |
| 版號同步 | Task 5 |
| 非目標：自動同步 published | 不做 |

## Placeholder scan

無 TBD／「稍後實作」步驟；簽名與檔名前後一致（`scheduleFacebookTarget`／`rescheduleFacebookTarget`／`cancelFacebookTarget`／`shouldClaimTargetForLocalPublish`／`deleteScheduled`）。
