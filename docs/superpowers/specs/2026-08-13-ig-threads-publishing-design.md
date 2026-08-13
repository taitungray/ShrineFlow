# Instagram／Threads 真發布＋本機排程；移除 LINE — 設計規格

日期：2026-08-13  
狀態：設計核准，待實作計畫  
前置：`2026-08-13-multi-client-publishing-design.md`、`2026-08-13-facebook-native-scheduling-design.md`  
決策：方案 1（Adapter＋本機排程＋`PUBLIC_MEDIA_BASE_URL`）；LINE 從產品移除；設定頁管理憑證

---

## 1. 這次要解決什麼

現況只有 Facebook 可真發布／原生排程。Instagram、Threads、LINE VOOM 僅有預覽骨架（`canPublish: false`）；到期非 FB target 標 `skipped_unsupported`。

本規格改成：

- **移除 LINE VOOM**（平台、帳號、預覽、客戶欄位、文案）
- **Instagram** 真發布：貼文（含輪播）、Reel、限時動態；可立刻發與排程
- **Threads** 真發布：貼文（文字／圖／影）；可立刻發與排程
- IG／Threads **無** Graph 原生排程能力 → 本機 `scheduler` 到期真發
- 設定頁新增憑證與公開媒體基底 URL（Meta 需能抓媒體）

---

## 2. 成功標準與非目標

| 項目 | 決定 |
| --- | --- |
| 成功標準 | IG feed／reel／story 與 Threads post 立刻發布成功後，平台可見內容；本機 target 標 `published`＋`externalId` |
| 成功標準 | IG／Threads 排程寫入本機後，服務開著且到期會真發；關機則不會發（與 FB 原生排程差異須在 UI 說明） |
| 成功標準 | 有媒體時未設 `PUBLIC_MEDIA_BASE_URL` → API／UI 明確拒絕，不靜默失敗 |
| 成功標準 | LINE 從平台列表、預覽、客戶設定、帳號模型完全消失 |
| 成功標準 | FB 原生排程行為不變；本機不對已交 FB 佇列的 target 雙發 |
| 非目標 | OAuth 完整授權流（仍手貼 Token／User ID） |
| 非目標 | IG／Threads 平台原生排程佇列 |
| 非目標 | 自動把平台已公開狀態 sync 回本機 |
| 非目標 | 第三方 CDN／S3 媒體托管 |
| 非目標 | App Review／正式部署流程本體 |

---

## 3. 白話行為

1. 設定頁填 IG／Threads User ID＋Token、可選填 `PUBLIC_MEDIA_BASE_URL`（有圖／影必填）→ 測連線  
2. 編輯預覽勾 IG／Threads 帳號與格式 → 立刻發布：當下走 container → publish  
3. 排程：本機標記 `scheduled`＋`scheduledAt`（**不**預建 Meta container；container 約 24h 過期）  
4. 到點：本機 `scheduler` 呼叫對應 publisher → 成功改 `published`  
5. 改時間／取消：只改本機（無遠端排程物件）  
6. FB 目標：維持既有原生排程／改時間／取消同步粉專  

---

## 4. 與既有規格的關係

沿用 `posts.targets[]` 為發布／排程真相：

| 欄位 | IG／Threads 語意 |
| --- | --- |
| `platformId` | `instagram` 或 `threads` |
| `contentType` | IG：`feed`／`reel`／`story`；Threads：`post` |
| `scheduledAt` | 預計公開時間（ISO） |
| `status: scheduled` | **等本機到期真發**（與 FB「已在粉專佇列」不同） |
| `externalId` | 真發成功後寫入；排程等待期間可為 `null` |

多客戶：憑證優先客戶帳號 `credentials`，否則 fallback 全域 `.env`（對齊現有 FB 模式）。

FB 規格交叉引用：本機 scheduler **仍略過**「FB＋已有 `externalId` 的 scheduled」；改為對 IG／Threads scheduled 執行真發。

---

## 5. 發布與排程規則

### 5.1 支援矩陣

| 平台 | contentType | 立刻發布 | 排程 |
| --- | --- | --- | --- |
| Instagram | `feed`（單圖／輪播／單影） | ✅ | ✅ 本機 |
| Instagram | `reel` | ✅ | ✅ 本機 |
| Instagram | `story` | ✅ | ✅ 本機 |
| Threads | `post`（TEXT／IMAGE／VIDEO） | ✅ | ✅ 本機 |
| Facebook | 既有 | ✅ | ✅ 原生（不變） |

### 5.2 Instagram 流程

1. `POST /{ig-user-id}/media` 建立 container（輪播：子項＋父 container）  
2. 輪詢 container `status_code` 至 `FINISHED`（逾時失敗）  
3. `POST /{ig-user-id}/media_publish`  
4. 回傳 media id → `externalId`

Story：單媒體、無 caption。Reel：影片＋caption。

### 5.3 Threads 流程

1. Base：`https://graph.threads.net`（與 `graph.facebook.com` 分開）  
2. `POST /{threads-user-id}/threads`（`media_type`＝TEXT／IMAGE／VIDEO）  
3. 等待處理後 `POST /{threads-user-id}/threads_publish`  
4. 回傳 id → `externalId`

### 5.4 媒體公開 URL

- Meta 從 URL **拉取**媒體，不能只靠本機 multipart（與 FB Page 上傳不同）  
- 設定 `PUBLIC_MEDIA_BASE_URL`（例 tunnel：`https://xxxx.ngrok-free.app`）  
- `/uploads/foo.jpg` → `{PUBLIC_MEDIA_BASE_URL}/uploads/foo.jpg`  
- 有媒體且 BASE 空／無效 → **400**，中文說明需公網或 tunnel  
- Threads 純文字：不需 BASE  

### 5.5 排程／改時間／取消（IG／Threads）

| 動作 | 行為 |
| --- | --- |
| 建立排程 | 驗證時間（合理未來時間即可；不套 FB 的 10 分～6 月 Graph 窗，可設最短緩衝如 ≥1 分鐘防誤觸）→ 寫 `scheduled` |
| 改時間 | 更新本機 `scheduledAt` |
| 取消 | `status=draft`，清 `scheduledAt`／`externalId`／`lastError` |
| 到期 | `scheduler` 呼叫 publisher；暫時性錯誤沿用既有最多 3 次 retry |

不預建 container。不呼叫遠端刪除。

### 5.6 立刻發布

不寫排程欄位；直接 publisher → `published`。

---

## 6. API／模組變更

| 模組 | 變更 |
| --- | --- |
| `lib/instagram.js` | 新建：container／publish／測連線；`createInstagramPublisher` |
| `lib/threads.js` | 新建：container／publish／測連線；`createThreadsPublisher` |
| `lib/media-public-url.js`（或等價小模組） | 由相對 `/uploads`＋BASE 組絕對 URL；缺 BASE 拋錯 |
| `lib/routes/publish.js` | 依 `platformId` 分派 FB／IG／Threads |
| `lib/routes/schedule.js` | FB 走原生；IG／Threads 本機排程；改時間／取消分岔 |
| `lib/scheduler.js` | 對 IG／Threads `scheduled` 到期真發；FB＋externalId 仍略過 |
| `lib/platforms.js` | 移除 `line`；IG／Threads `canPublish` 依設定 |
| `lib/platform-accounts.js`／`clients`／前端客戶 UI | 移除 LINE；IG／Threads 帳號可 enabled |
| `lib/settings.js`＋設定路由／UI | 新增 env 欄位與測連線 |
| `public/**` | 移除 LINE 預覽／文案；排程提示區分原生 vs 本機 |
| 測試 | `test/instagram.test.js`、`test/threads.test.js`；排程／scheduler 擴充 |

### 6.1 憑證與設定

**客戶帳號（對齊現有 FB UI）**

- Instagram：`credentials.userId`＋`credentials.accessToken`（設定頁「目前客戶」區塊儲存）  
- Threads：同上  
- `configured`／`enabled`：兩者皆有值則為 true  
- 測連線：擴充 `POST /api/clients/:id/accounts/:accountId/test` 支援 IG／Threads  

**全站 `.env`／設定**

- `PUBLIC_MEDIA_BASE_URL`（有媒體必填）  
- 既有 `META_GRAPH_VERSION` 供 IG（`graph.facebook.com`）  
- Threads base：`https://graph.threads.net`；API 版本預設 `v1.0`（可選 env `THREADS_GRAPH_VERSION`）  
- 可選：全域 `.env` IG／Threads 欄位僅作 bootstrap fallback（與 FB `.env`→預設客戶同模式）；主路徑仍是客戶帳號

---

## 7. 狀態語意（IG／Threads target）

| status | 意義 |
| --- | --- |
| `draft` | 未排／已取消 |
| `scheduled` | 等本機到期真發 |
| `publishing` | 立刻發或到期發進行中 |
| `published` | 平台已公開（有 `externalId`） |
| `failed` | 發布失敗（含缺 BASE、Token、Graph 錯） |
| `skipped_unsupported` | **不再**用於 IG／Threads（僅遺留資料相容；新碼不寫入） |

貼文層彙總仍依多客戶規格。

---

## 8. 錯誤處理

- 單一 target 失敗不影響其他 target  
- 缺憑證 → 503／明確訊息  
- 缺 `PUBLIC_MEDIA_BASE_URL`（有媒體）→ 400  
- Graph／Threads API 錯誤 → 中文包裝＋保留可除錯原文於 `lastError`  
- Scheduler 暫時性錯誤：既有 retry；用盡 → `failed`  

---

## 9. 測試範圍

- Instagram publisher：feed／reel／story mock；輪播；缺 BASE 拒絕  
- Threads publisher：TEXT／IMAGE；缺 BASE（有媒體）拒絕；純文字可過  
- Publish／schedule 路由：分派正確平台；IG／Threads 排程不呼叫遠端排程  
- Scheduler：到期對 IG／Threads 呼叫 publish；FB＋externalId 不雙發  
- LINE 移除：平台定義與 accounts 不再含 `line`  
- 純前端可不跑後端全套；後端改動跑對應 `node --test` 檔  

---

## 10. Phase 邊界（實作順序）

1. 移除 LINE（全產品面）  
2. 設定欄位＋`PUBLIC_MEDIA_BASE_URL`＋測連線  
3. Instagram publisher＋立刻發布＋本機排程／scheduler  
4. Threads publisher＋立刻發布＋本機排程／scheduler  
5. UI 文案（本機排程 vs FB 原生）＋版號 bump  

可同一實作計畫分 Task；合併 PR 前三平台（FB 既有＋IG＋Threads）與無 LINE 狀態一致。

---

## 11. 決策紀錄

| 問題 | 選擇 |
| --- | --- |
| 範圍 | IG＋Threads 真發＋排程；LINE 整包移除 |
| 排程模型 | 能原生用原生（僅 FB）；IG／Threads 本機到期真發 |
| 憑證 | 設定頁＋`.env`（手貼 Token） |
| IG 格式 | feed＋reel＋story |
| Threads 格式 | post |
| 媒體 | `PUBLIC_MEDIA_BASE_URL`＋tunnel／公網；不做 S3 |
| 架構 | 獨立 publisher adapter（方案 1） |

---

## 12. 自檢摘要

- 無 TBD；IG／Threads 無原生排程、媒體需公開 URL、與 FB `scheduled` 語意差異已寫明  
- 與多客戶 `targets`、FB 原生排程規格一致且不互相雙發  
- 失敗不靜默；缺 BASE 明確拒絕  
- Phase：先砍 LINE → 設定 → IG → Threads → UI／版號  
