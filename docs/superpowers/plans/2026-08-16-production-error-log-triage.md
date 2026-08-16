# 正式環境錯誤記錄與已修正閉環 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This session:** 使用者授權自行定案且要求不要再問。本計畫由同一 session **inline 執行**。**不要 commit**（專案規定：未明確要求 commit 則不 commit）。

**Goal:** 正式環境 Console／網路錯誤寫入同一份 `error-log`，指紋合併，設定頁可下載並標已修正，再出現則重開。

**Architecture:** 擴充 `lib/error-log.js`（指紋、count、`open`/`fixed`）。伺服器 HTTP 改記 4xx/5xx（排除探針）。前端 reporter POST `/api/system/client-errors`。設定頁篩選／標已修／匯出。補 favicon 消除已知 404。

**Tech Stack:** Express + 靜態 HTML/CSS/JS、`data/error-log.json`、既有 `node --test`。

## Global Constraints

- 前端維持 Express + 靜態頁，不引入 React/Vue/Sentry。
- UI 跟 `ui-ux-pro-max`：`.radio-pill-group`、觸控 ≥ 44px、禁止水平捲軸。
- 錯誤寫入失敗不得蓋過原請求；message 遮罩 token，最長 500。
- 最多 500 筆、30 天；不把 `data/error-log.json` 當靜態檔暴露。
- `POST /api/system/client-errors` 權限是 `content.view`；list／export／resolve 是 `system.manage`。
- 版號與 `?v=` 同步 bump。
- 未要求則不 git commit。

---

## File map

| 檔案 | 職責 |
| --- | --- |
| `lib/error-log.js` | 指紋、合併、resolve、HTTP 是否該記、client ingest、export payload |
| `lib/routes/system.js` | list 篩選、export、resolve、client-errors |
| `lib/api-authorization.js` | client-errors 特判 `content.view` |
| `server.js` | HTTP 4xx/5xx hook、`/favicon.ico` 301 |
| `public/modules/client-error-reporter.js` | 前端捕捉與 POST |
| `public/modules/api.js` | 不改行為；reporter 包 `fetch` |
| `public/modules/system.js` | 設定頁列表、篩選、標已修、下載 |
| `public/index.html` | 錯誤記錄 UI、favicon link、`?v=` |
| `public/style.css` | 錯誤列次數／已修標記 |
| `public/favicon.svg` | 品牌標 |
| `public/app.js` | 啟動 reporter |
| `package.json` | 版號 |
| `test/error-log.test.js` | 合併／重開／篩選／HTTP skip |
| `test/api-authorization.test.js` | 新路由權限 |
| `test/client-error-reporter.test.js` | 忽略 URL 純函式 |

---

### Task 1: 指紋合併、已修正、篩選

**Files:**
- Modify: `lib/error-log.js`
- Test: `test/error-log.test.js`

**Interfaces:**
- Consumes: 既有 `appendErrorLog`、`listErrorLogs`、`ERROR_LOG_RETENTION_POLICY`
- Produces: `errorFingerprint(entry)`、`shouldRecordHttpError(status, path)`、`resolveErrorLog(id)`、`ingestClientError(payload)`、`exportErrorLogs({ status })`、`listErrorLogs({ limit, scope, status })`；entry 含 `fingerprint` `count` `lastSeenAt` `resolutionStatus` `resolvedAt` `source`

- [ ] **Step 1: Write failing tests in `test/error-log.test.js`**

同檔既有測試仍過。新增：同指紋合併 count；fixed 後 append 重開；list `status=open`；`shouldRecordHttpError(404, '/favicon.ico') === true`、readiness 503 false、auth 401 false。

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test test/error-log.test.js`

- [ ] **Step 3: Implement `lib/error-log.js`**

關鍵行為：

```js
export const CLIENT_ERROR_SCOPES = Object.freeze(['client_js', 'client_network', 'client_resource']);

export function normalizeErrorPath(path = '') {
  const raw = String(path || '').trim();
  try {
    if (/^https?:\/\//i.test(raw)) return trim(new URL(raw).pathname, 200);
  } catch {}
  return trim(raw.split('?')[0].split('#')[0], 200);
}

export function errorFingerprint(entry = {}) {
  const method = trim(entry.method, 12).toUpperCase();
  const path = normalizeErrorPath(entry.path);
  const code = trim(entry.code, 80);
  const status = safeStatus(entry.status);
  if (status) return ['http', method, path, String(status), code].join('|');
  return [trim(entry.scope, 80), method, path, code, trim(entry.message, ERROR_LOG_RETENTION_POLICY.maxMessageLength)].join('|');
}

export function shouldRecordHttpError(statusCode, path = '') {
  const status = Number(statusCode);
  if (!Number.isInteger(status) || status < 400 || status > 599) return false;
  const normalized = normalizeErrorPath(path);
  if (normalized === '/api/healthz' || normalized === '/healthz') return false;
  if (normalized.endsWith('/system/readiness')) return false;
  if (normalized.endsWith('/system/client-errors')) return false;
  if (status === 401 && normalized.startsWith('/api/auth/')) return false;
  return true;
}
```

`appendErrorLog` 在 mutate 裡找同 fingerprint：有則 `count+1`、更新 `lastSeenAt`／message／status／code；若 `fixed` 則改 `open`、`resolvedAt=null`。無則 push 新筆（`count: 1`、`resolutionStatus: 'open'`、`source` 由 scope 前綴 `client_` 判斷）。prune 用 `lastSeenAt || createdAt`。

`resolveErrorLog(id)`：找到則 `fixed` + `resolvedAt`，否則 `null`。

`ingestClientError`：scope 必須在 `CLIENT_ERROR_SCOPES`，否則 throw `{ status: 400 }`。每 actorId 每分鐘 30 次，超出 throw `{ status: 429 }`。然後 `appendErrorLog({ source: 'client', ... })`。

- [ ] **Step 4: Run `node --test test/error-log.test.js` — expect PASS**

---

### Task 2: API 與權限

**Files:**
- Modify: `lib/routes/system.js`
- Modify: `lib/api-authorization.js`（`/system/` catch-all 之前）
- Modify: `server.js` HTTP hook
- Test: `test/api-authorization.test.js`、`test/error-log.test.js`（若 ingest 已在 Task 1）

**Interfaces:**
- Consumes: Task 1 函式
- Produces: `GET /api/system/error-log?status=`、`GET /api/system/error-log/export`、`POST /api/system/error-log/:id/resolve`、`POST /api/system/client-errors`

- [ ] **Step 1: Authorization test**

```js
assert.equal(resolveApiAuthorizationRule({ method: 'POST', path: '/system/client-errors' }).permission, 'content.view');
assert.equal(resolveApiAuthorizationRule({ method: 'POST', path: '/system/error-log/abc/resolve' }).permission, 'system.manage');
assert.equal(resolveApiAuthorizationRule({ method: 'GET', path: '/system/error-log/export' }).permission, 'system.manage');
```

- [ ] **Step 2: Implement rule + routes + HTTP hook**

`server.js`：

```js
if (!shouldRecordHttpError(response.statusCode, request.path)) return;
appendErrorLog({ scope: 'http', method: request.method, path: request.path, status: response.statusCode, durationMs: Date.now() - startedAt })
```

Export：`Content-Disposition: attachment; filename="shrineflow-error-log.json"`，body `{ version: 1, exportedAt, items }`。

- [ ] **Step 3: Run `node --test test/error-log.test.js test/api-authorization.test.js` — expect PASS**

---

### Task 3: 前端 reporter

**Files:**
- Create: `public/modules/client-error-reporter.js`
- Create: `test/client-error-reporter.test.js`（抽 `shouldIgnoreClientErrorUrl`）
- Modify: `public/app.js` 啟動 `initClientErrorReporter()`

**Interfaces:**
- Consumes: `POST /api/system/client-errors`
- Produces: `shouldIgnoreClientErrorUrl(url)`、`initClientErrorReporter()`

忽略：`/api/system/client-errors`、`/api/system/error-log`、`chrome-extension:`、`moz-extension:`。

包 `window.fetch`：若 `!ok` 且不忽略，fire-and-forget POST。`window.error` + `unhandledrejection` + capture resource error。自身 POST 失敗不上報。10 秒 debounce。

- [ ] **Step 1–4:** 測試忽略 URL → 實作 → `node --test test/client-error-reporter.test.js` PASS → `app.js` 呼叫 init（auth 之後即可，401 則靜默）

---

### Task 4: 設定頁 UI + favicon + 版號

**Files:**
- Modify: `public/index.html`、`public/modules/system.js`、`public/style.css`
- Create: `public/favicon.svg`
- Modify: `server.js` `GET /favicon.ico` → 301 `/favicon.svg`
- Modify: `package.json` version bump、HTML `?v=`

**Interfaces:**
- Consumes: list／resolve／export API
- Produces: pill 篩選、標已修正、下載 JSON、favicon 不再 404

UI：`radio-pill-group` 未修正／已修正／全部；列上次數與「標已修正」；`btnRefreshErrorLog` 旁「下載 JSON」。

- [ ] **Step 1:** 改 HTML／JS／CSS／svg／301／版號
- [ ] **Step 2:** `node --test test/error-log.test.js test/api-authorization.test.js test/client-error-reporter.test.js` PASS

---

## Self-review

| Spec 要求 | Task |
| --- | --- |
| 指紋合併 + 重開 | 1 |
| HTTP 4xx 含 favicon、排除 readiness | 1+2 |
| Client JS／network／resource | 3 |
| list／export／resolve／client-errors 權限 | 2 |
| 設定頁篩選／標已修／下載 | 4 |
| favicon 修復 | 4 |
| 遮罩、不上報 stack/body | 1+3 |
| 版號 | 4 |
