# 正式環境錯誤記錄與已修正閉環 — 設計規格

日期：2026-08-16  
狀態：已決定（使用者授權自行定案，不再追問）  
前置：`lib/error-log.js`、`GET /api/system/error-log`、設定頁「查看錯誤記錄」、`data/error-log.json`  
決策：擴充**同一份**錯誤記錄，不另開檔、不接 Sentry。

---

## 1. 這次要解決什麼

正式環境使用者操作時，瀏覽器 Console 會出現錯誤（例如 `GET /favicon.ico 404`），但：

- HTTP middleware 只記 **429 與 5xx**，4xx（含 favicon 404）不進 log
- 前端未捕捉例外、`fetch` 失敗、資源載入失敗不進 `data/error-log.json`
- 設定頁只能看最近 20 筆，不能下載、不能標已修正
- 同一錯會重複佔滿 500 筆上限

成功標準：

1. 正式環境已登入操作時，JS 未捕捉例外、App API 失敗、瀏覽器網路／資源失敗會進同一份錯誤記錄。
2. 同指紋合併成 1 筆，累計次數與最後發生時間。
3. 設定頁可篩未修正／已修正、標已修正、下載 JSON。
4. 已修正後同一指紋再出現自動重開。
5. Token／密鑰仍遮罩；寫入失敗不得蓋過原請求。

---

## 2. 非目標

- Sentry、外部 APM、郵件告警、即時推播。
- 完整 stack dump、request body、Cookie、Authorization。
- Console warning、Chrome 套件、`chrome-extension://`。
- 把錯誤 log 做成工單系統或指派負責人。
- 改動發布紀錄頁的 `lastError` 資料模型。

---

## 3. 資料模型

沿用 `data/error-log.json`：`{ version: 1, items: [] }`。Firestore 仍是 singleton `errorLog`。

每筆欄位（舊筆讀取時缺欄給預設）：

| 欄位 | 說明 |
| --- | --- |
| `id` | 首次出現時產生，合併時不變 |
| `createdAt` | 首次出現 |
| `lastSeenAt` | 最後一次出現（新筆 = `createdAt`） |
| `count` | 出現次數，從 1 起 |
| `fingerprint` | 合併鍵 |
| `resolutionStatus` | `open` 或 `fixed` |
| `resolvedAt` | 標已修正時間；重開時清成 `null` |
| `source` | `server` 或 `client` |
| 既有 | `scope` `method` `path` `status` `platformId` `code` `message` `retriable` `durationMs` |

保留策略不變：最多 500 筆、30 天、message 最長 500、敏感字遮罩。prune 以 `lastSeenAt || createdAt` 判斷年齡。

### 指紋

正規化 path：只留 pathname（絕對 URL 取 pathname），去掉 query／hash，再走既有 `trim` 遮罩。

- 有 HTTP `status`：`http|{method}|{path}|{status}|{code}`  
  讓伺服器 404 與前端資源 404（同 path／status）合成一筆。
- 無 status（JS 例外）：`{scope}|{method}|{path}|{code}|{message}`

---

## 4. 寫入來源

### 4.1 伺服器 HTTP

`server.js` finish hook 改為：status **400–599** 都記，但排除：

- path 為 `/api/healthz`、`/healthz`、結尾 `/system/readiness`、結尾 `/system/client-errors`
- `/api/auth/*` 的 401

`/favicon.ico` 404 **要記**（這就是 Console 那筆）。補 favicon 後此指紋不再新發生。

### 4.2 既有伺服器來源

`http_exception`、scheduler、evergreen、upload_cleanup 仍走 `appendErrorLog`；改為指紋合併，不再每發一筆新 id。

### 4.3 前端

`public/modules/client-error-reporter.js` 在登入後啟動：

| 來源 | `scope` |
| --- | --- |
| `window.error`（腳本例外） | `client_js` |
| `unhandledrejection` | `client_js` |
| `window.error` capture（`img`／`script`／`link` 資源） | `client_resource` |
| 包裝後的 `fetch`，`!response.ok` | `client_network` |

不上報：

- `/api/system/client-errors`、`/api/system/error-log`（防迴圈）
- `chrome-extension:`、`moz-extension:`
- 前端 10 秒內同 debounce key 不重複 POST

`api()` 繼續丟 Error；reporter 看 `fetch` 層即可，不必每支 `catch` 再打一次。

---

## 5. API

| 方法 | 路徑 | 權限 | 行為 |
| --- | --- | --- | --- |
| `GET` | `/api/system/error-log` | `system.manage` | `limit`、`scope`、`status=open\|fixed\|all`（預設 `all`）。依 `lastSeenAt` 新到舊 |
| `GET` | `/api/system/error-log/export` | `system.manage` | 下載 JSON 附件，內容已遮罩 |
| `POST` | `/api/system/error-log/:id/resolve` | `system.manage` | 標 `fixed`；找不到 404 |
| `POST` | `/api/system/client-errors` | **已登入 `content.view`** | 寫入／合併；未知 scope 400；每 actor 每分鐘最多 30 次則 429 |

`POST /api/system/client-errors` 必須在 `/system/` 的 `system.manage` 規則**之前**特判，否則一般操作員無法上報。

Client body 只收：`scope` `method` `path` `status` `code` `message`。不收 stack。伺服器再 trim／遮罩。

---

## 6. 已修正閉環

1. 操作員（`system.manage`）在設定頁按「標已修正」→ `resolutionStatus=fixed`、`resolvedAt=now`。
2. 同一指紋再 `appendErrorLog`：`count+1`、更新 `lastSeenAt`／最新 message，`resolutionStatus` 改回 `open`，`resolvedAt=null`。
3. 不刪除已修正筆；篩選「已修正」仍看得到。

---

## 7. UI（設定頁既有錯誤記錄區塊）

沿用 `ui-ux-pro-max`：`.field`、`.radio-pill-group`（2–4 項不用 select）、按鈕觸控 ≥ 44px、`flex-wrap` 禁止水平捲軸。

- 篩選 pill：未修正／已修正／全部
- 每列：scope、status、message、次數、最後發生、未修則「標已修正」
- 「下載 JSON」「重新整理」
- 預設顯示未修正；列表最多 50 筆（下載為全量上限 500）

---

## 8. favicon

專案目前沒有 favicon，Chrome 會對站根要 `/favicon.ico` 得到 404。

- 新增 `public/favicon.svg`（品牌赤硃／金箔簡標）
- `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`
- `GET /favicon.ico` 301 到 `/favicon.svg`，避免瀏覽器預設請求繼續 404

這筆與錯誤記錄同一包做：log 系統能抓住這類錯，同時把已知的 favicon 404 修掉。

---

## 9. 安全

- 既有 token 遮罩保留；client 上報同樣走 `trim`
- 不上報 body、header、Cookie
- 寫入失敗吞掉，不取代原錯誤
- 匯出仍是已遮罩資料，不把 `data/error-log.json` 當靜態檔

---

## 10. 測試

- `appendErrorLog` 同指紋合併、count、lastSeenAt
- `fixed` 後再 append 重開
- `listErrorLogs` 依 status 篩
- `shouldRecordHttpError`：404 要記、readiness 503 不記、auth 401 不記
- `resolveErrorLog` 找不到回 null
- `resolveApiAuthorizationRule`：`POST /system/client-errors` → `content.view`；resolve／export → `system.manage`
- 前端純函式：忽略 extension URL、忽略 error-log 自身 path

---

## 11. 版號

`package.json` 與前端 `?v=` 同步 bump（實作時依當下版號 +0.0.01）。
