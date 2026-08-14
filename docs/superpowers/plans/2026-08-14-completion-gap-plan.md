# ShrineFlow 未完成項目與補強計畫

> 建立日期：2026-08-14  
> 依據版本：v0.5.34
> 目前驗收結果：PASS WITH ISSUES  
> 適用範圍：單一操作員、無資料庫、JSON 儲存、多品牌、多平台

## 1. 計畫目的

本計畫承接目前驗收結果，補齊會影響內容生命週期、發布狀態正確性、資料可恢復性與正式上線的項目。

本計畫不改變目前已確認的產品方向：

- 不限制內容主題，不再以神明作為必要欄位。
- 一個操作員操作；保留未來擴充彈性，但本階段不導入多使用者權限與協作流程。
- 支援多品牌與多平台；「多平台」是正式用語，不使用容易混淆的「多帳號」描述功能。
- 不使用資料庫，持續使用具備鎖定、原子寫入、備份與容量上限的 JSON 儲存層。
- 歷史紀錄不因一般操作自動消失；但所有可累積資料都必須有明確的保留、封存、匯出與上限政策，避免無限膨脹。

## 2. 目前狀態與缺口

| 項目 | 現況 | 優先級 | 補強目標 |
|---|---|---:|---|
| 多平台混合結果 | `published + failed` 目前會彙總成 `failed` | P0 | 增加 `partial_success`，讓總覽與列表正確反映部分成功 |
| 自動儲存 | 目前只有手動儲存與 dirty state | P1 | 編輯中自動儲存、離線恢復、競態保護與離頁提醒 |
| 版本歷史 | 目前沒有貼文版本 API 與歷史檔 | P1 | 每次重要儲存保留可檢視、可還原的版本 |
| 封存／還原／複製 | 目前沒有貼文生命週期管理 API | P1 | 提供可恢復封存、還原、複製，支援容量管理 |
| 外部 Meta 審查 | App Review、Business Verification、真實帳號驗證尚未完成 | P0 外部 | 完成正式申請前置資料與真實環境驗證 |
| 正式部署 | HTTPS、公開媒體網址、Webhook、備份還原演練尚未完成 | P0 外部 | 完成可部署、可監控、可還原的 production runbook |
| 舊規劃文件 | 部分舊文件仍保留未勾選項目 | P2 文件 | 區分「已完成」、「刻意不做」、「尚待實作」，避免狀態誤判 |

### 2.1 刻意不列入本計畫的項目

以下項目不是目前缺陷，而是符合單一操作員階段的範圍決策：

- 多使用者帳號、角色與權限矩陣。
- Writer／Reviewer／Publisher 審核流程。
- 多人同時編輯與協作衝突合併。
- 以資料庫取代 JSON 儲存。
- 企業級 SSO、組織管理與跨團隊稽核。

若未來要開放多人，再另開一份架構計畫，不能把本計畫的單一操作員流程直接延伸成權限系統。

## 3. 實作順序總覽

```text
P0 狀態正確性與上線阻擋
  ├─ partial_success 狀態機
  ├─ 平台狀態顯示一致化
  └─ Meta / HTTPS / production 前置清單

P1 編輯可靠性與內容生命週期
  ├─ Autosave
  ├─ 版本歷史與還原
  └─ 封存／還原／複製

P2 資料治理與 UI 完整性
  ├─ JSON 歷史與封存上限
  ├─ Content / Calendar / Logs 操作介面
  └─ 狀態、篩選、錯誤與恢復提示一致化

P3 正式驗收與部署
  ├─ 完整自動化測試
  ├─ 手機與瀏覽器回歸
  ├─ 真實 Meta 測試帳號
  └─ 備份還原與 production readiness
```

實作原則：先修正狀態正確性，再增加編輯與資料生命週期，最後才進行外部平台與正式部署驗收。這樣可以避免 UI 已完成但底層狀態仍無法正確表達的情況。

## 4. P0：修正多平台狀態與正式上線阻擋

### 4.1 `partial_success` 狀態機

#### 目標

當同一篇貼文有多個平台 target 時，總狀態必須能區分：全部成功、全部失敗、尚在排程、部分成功與尚未開始。

#### 建議狀態規則

| Target 組合 | Post 總狀態 |
|---|---|
| 沒有 target | `draft` |
| 有 active target，但尚無任何已發布 target | `scheduled` |
| 至少一個 `published`，且仍有 `failed`／`retrying`／`scheduled`／`publishing`／`pending` | `partial_success` |
| 全部為 `published`，或成功發布加上明確 `skipped_unsupported` | `published` |
| 有 `failed`，且沒有 `published`、沒有可繼續等待的 active target | `failed` |
| 其他尚未完成編輯狀態 | `draft` |

Target 狀態仍是實際發布真相，Post 狀態只是彙總結果；不能用 Post 狀態取代每個平台的詳細狀態。

#### 實作內容

1. 修改 `lib/post-targets.js` 的 `summarizePostStatus`。
2. 增加 `partial_success` 的狀態標籤、顏色與說明文字。
3. 更新總覽、內容列表、Calendar、Composer 預覽、發布紀錄與 Insights 的狀態映射。
4. 確認 retry、reschedule、cancel 後會重新計算 Post 總狀態。
5. UI 顯示「哪些平台成功、哪些平台失敗、哪些平台等待中」，不能只顯示一個總狀態。

#### 驗收條件

- Facebook 成功、Instagram 失敗、Threads 尚未發布時，總狀態為 `partial_success`。
- retry 成功後，若全部成功，總狀態變為 `published`。
- 全部失敗時仍為 `failed`。
- 混合 scheduled 與 published 時，不再錯誤地只顯示 `scheduled`。
- 重整頁面後狀態與 target 詳細資料一致。

### 4.2 Meta 審查與真實平台驗證

程式測試目前以 mock provider 為主，不能視為已完成 Meta 實際上線資格。

#### 待辦

1. 建立 Meta App 的正式環境設定與權限清單。
2. 使用真實 Facebook Page、Instagram Professional Account、Threads 帳號進行驗證。
3. 驗證長效 Token、Token 健康狀態、過期與撤銷後的錯誤提示。
4. 驗證 Facebook 原生排程、Instagram／Threads 本機排程的實際結果。
5. 錄製 App Review 所需流程：發布、失敗、重試、取消排程、格式驗證、Token 狀態。
6. 完成既有 Meta checklist 中的權限、Privacy Policy、Data Deletion、Webhook 與測試帳號資料。

此項需要外部 Meta 帳號與審查結果，程式碼本身無法單獨標記為完成。

### 4.3 正式部署與 HTTPS

#### 部署前置

- 伺服器綁定 `0.0.0.0`，正式環境使用 HTTPS。
- 設定 `PUBLIC_MEDIA_BASE_URL` 為可被 Meta 讀取的 HTTPS 網址。
- 設定操作員密碼、Session Secret、加密主金鑰與 Meta App Secret。
- 設定 Webhook callback、verify token 與簽章驗證。
- 建立反向代理、健康檢查、readiness check 與錯誤告警。
- 明確限制 `/uploads` 公開媒體的存取範圍與保存時間；目前公開網址是 Instagram／Threads 讀取媒體的必要條件，正式環境需搭配隔離媒體主機或明確的檔案生命週期。

#### 備份與還原演練

1. 產生不含明文 secrets 的 JSON 備份。
2. 在隔離環境還原備份。
3. 驗證品牌、貼文、target、排程、發布紀錄與設定可讀取。
4. 驗證媒體檔與 JSON 參照關係。
5. 驗證還原失敗時不會覆蓋目前可用資料。
6. 記錄演練日期、備份版本、結果與人工確認人員。

正式部署完成的條件不是「服務能啟動」，而是「能監控、能備份、能還原、能安全處理失敗」。

## 5. P1：編輯可靠性與內容生命週期

### 5.1 Autosave

#### 目標

使用者在 Composer 編輯一般欄位時，自動保存目前貼文草稿，不要求使用者反覆點擊手動保存；發布與排程前仍必須通過完整驗證。

#### 建議流程

```text
欄位變更
  → editorDirty = true
  → debounce 800ms
  → 帶上 postId + clientRevision 送出 PATCH
  → 成功：更新 serverVersion、lastSavedAt、清除 dirty
  → 失敗：保留 dirty，顯示可重試提示
  → 競態：以 revision / version 拒絕舊回應覆蓋新內容
```

#### 必要規則

- 只對已建立的貼文啟用伺服器 Autosave；新貼文第一次仍需建立草稿。
- 媒體檔案不寫入 localStorage，只保存媒體路徑與未完成編輯 metadata。
- 瀏覽器本地只保留目前品牌、目前貼文的一份復原草稿，並設定 7 天過期時間。
- 網路失敗時顯示「尚未儲存」，不能假裝成功。
- 舊的 response 不得覆蓋較新的編輯內容。
- 離開頁面或切換貼文時，若仍 dirty，顯示離頁提醒或先嘗試保存。
- 發布、排程、切換平台前，若仍 dirty，先完成保存或阻止操作並說明原因。

#### 建議 API 契約

- `PATCH /api/posts/:postId` 接受 `clientRevision` 或 `baseVersion`。
- 版本不一致回傳 `409 POST_VERSION_CONFLICT`，同時提供目前 server 版本摘要。
- 成功回傳 `version`、`updatedAt`、`savedAt`。
- 不新增無限 autosave event；只更新目前 Post，重要版本才進入版本歷史。

#### 驗收條件

- 快速連續輸入不會產生多個互相覆蓋的請求結果。
- 延遲回應的舊請求不會覆蓋新文字。
- 重新整理後可恢復最後一次成功保存的內容。
- 網路中斷、恢復、重試流程均有清楚狀態。
- localStorage 不保存 Token、密碼或完整媒體二進位資料。

### 5.2 貼文版本歷史與還原

#### 觸發版本的時機

只有下列事件產生版本，不把每一次按鍵都當成版本：

- 手動儲存完成且內容有實質變更。
- Autosave 後內容有實質變更，且距離上一版本至少 30 秒。
- 送出排程前。
- 發布前。
- 使用者手動選擇「建立版本」。

#### 版本內容

- 貼文欄位、base content、target overrides、media 路徑與 content settings。
- `postId`、`versionId`、版本號、建立時間、觸發來源。
- 單一操作員可保留 `actor: operator`，不虛構多人身份。
- 不保存 Token、Session、原始 Webhook payload 或不必要的 provider secrets。

#### JSON 與保留政策

- 目前貼文只保留 `currentVersion` 與版本號。
- 歷史拆到按月份分割的 JSON 檔，避免單一 `posts.json` 無限變大。
- 每篇貼文保留最近 20 個可直接還原版本。
- 已超過目前窗口的版本移到 archive，最多保留 24 個月。
- 每個月份檔案與總 archive 都設硬上限，超過上限時先產生 storage-health 警告，不靜默刪除。
- 提供手動匯出備份後，才允許使用者執行明確的歷史清理。
- 版本內容與發布 attempt 分開保存，避免一份資料被重複放大。

#### API

- `GET /api/posts/:postId/versions`
- `POST /api/posts/:postId/versions`
- `POST /api/posts/:postId/versions/:versionId/restore`

還原版本時建立新的 current version，不直接覆寫歷史，確保還原本身也能被追蹤與再次復原。

#### 驗收條件

- 可查看版本時間、觸發來源與差異摘要。
- 還原後 targets 的平台覆寫與媒體設定一致。
- 已發布貼文還原內容不會自動重新發布，只會建立新的草稿／待重新確認內容。
- 版本上限、月份分檔、archive 保留與 storage-health 警告有測試。

### 5.3 封存、還原與複製

#### 封存

- 封存只改變內容生命週期，不刪除貼文、target 或發布紀錄。
- 已發布貼文可以封存；正在發布或等待重試的 target 必須先完成、取消或明確處理。
- 封存貼文不出現在預設 Content、Calendar 與待處理列表，但可用篩選查詢。
- 封存動作需要二次確認，顯示貼文的多平台狀態。

#### 還原

- 還原後回到 `draft` 或 `ready`，不自動恢復舊的排程與 externalId。
- 舊的發布結果保留在歷史中，避免還原造成重複發布。
- 還原後必須重新通過平台格式驗證。

#### 複製

- 複製產生新的 `postId` 與 target IDs。
- 複製內容、平台覆寫與媒體參照，但重設排程、externalId、publishAttempts 與錯誤狀態。
- 新貼文一定是 `draft`，不能因來源已發布而直接進入發布狀態。
- 來源貼文只保留 `duplicatedFrom` metadata，不複製整份歷史紀錄。

#### API 與 UI

- `POST /api/posts/:postId/archive`
- `POST /api/posts/:postId/restore`
- `POST /api/posts/:postId/duplicate`
- Content 增加「目前／已封存」篩選。
- 每篇貼文提供封存、還原、複製操作。
- 儲存上限接近時顯示目前使用量、可封存項目與處理入口，而不是只顯示不可理解的錯誤。

## 6. P2：資料治理、UI 與文件同步

### 6.1 JSON 成長控制

所有新增資料都必須對應一項上限：

| 資料 | 保存方式 | 建議上限 |
|---|---|---:|
| 目前貼文 | `posts.json` | 沿用現有硬上限 |
| 貼文版本 | 月份分檔 | 每篇 20 個 active 版本、archive 24 個月 |
| 發布 attempt | 月份分檔 | 沿用現有月份與筆數上限 |
| 錯誤記錄 | bounded JSON | 沿用現有 200 筆與 retention policy |
| 通知 | bounded JSON | 沿用現有 200 筆、已讀 180 天 |
| 本地復原草稿 | 瀏覽器 localStorage | 每個操作員／品牌／貼文最多 1 份、7 天 |
| 媒體檔 | `uploads/` | quota、孤兒清理、檔案年齡限制 |

資料達到 80% 使用量時顯示警告，達到硬上限時拒絕新增並提供可操作的封存／匯出／清理路徑。禁止背景工作直接刪除使用者可見的貼文或版本。

### 6.2 UI 一致化

需同步調整：

- Content 列表：顯示 `partial_success` 與平台 breakdown。
- Calendar：顯示平台狀態、時區、失敗原因與重排程結果。
- Composer：顯示 Autosave 狀態、版本號、未保存提醒與多平台結果。
- Publishing Logs：連到 target attempt、retry、partial success 詳細資訊。
- Mobile：維持目前抽屜可滑動、右側點擊關閉、44px 觸控區與無水平溢位。
- 所有操作提供成功、失敗、重試中與不可用的明確文字，不只使用顏色區分。

### 6.3 文件同步

完成每一個階段後同步：

- `PROJECT_STATUS.md`：只記錄目前實際狀態。
- 本計畫：記錄完成日期、版本與驗收結果。
- 舊 plans：標記為 historical plan 或補上連結，避免未勾選項目被誤認為目前未完成。
- Meta checklist：外部驗證項目維持未完成，直到真實環境驗證完成。
- Deployment runbook：記錄實際環境變數、網址、備份演練與回滾方式，不把規劃當成部署完成。

## 7. P3：測試與正式驗收計畫

### 7.1 後端單元與整合測試

新增或補強以下測試：

1. `summarizePostStatus` 的全部平台組合與狀態優先序。
2. 三平台一成功、一失敗、一排程的 `partial_success`。
3. Autosave debounce、舊 response、409 conflict、網路失敗與重試。
4. 版本建立、列表、差異摘要、還原與還原後不自動發布。
5. 封存、還原、複製與 externalId／publishAttempts 清除規則。
6. JSON 版本月份分檔、archive 上限、storage-health 警告與明確清理。
7. 重整頁面後狀態、版本與 target 仍一致。
8. 發布、retry、cancel、reschedule 後總狀態重新彙總。

### 7.2 瀏覽器與手機回歸

至少驗證：

- 1280px 桌面 Composer、Content、Calendar、Logs。
- 768px 平板單欄與導覽。
- 390px 手機導覽抽屜滑動、右側點擊關閉、更多選單、輸入與底部操作列。
- 手機無水平捲軸，主要按鈕可觸控。
- Autosave 狀態在網路失敗與恢復時可理解。
- `partial_success` 在列表、詳情與手機畫面不被截斷。

### 7.3 Ship Gate

#### PASS

- P0 狀態正確性已通過。
- 158/158 現有測試與新增測試全部通過。
- 無重複發布、無時區錯誤、無狀態錯誤。
- 真實 Meta 測試帳號完成必要流程。
- HTTPS、Webhook、公開媒體網址與備份還原演練完成。

#### PASS WITH ISSUES

- 核心本機功能可用，但外部 Meta 審查或正式部署仍待完成。
- 所有未完成項目已在 `PROJECT_STATUS.md` 與本計畫明確列出，沒有把規劃誤標成完成。

#### FAIL

- 混合平台結果仍錯誤顯示。
- 可能重複發布或重試造成重複內容。
- Autosave 會用舊回應覆蓋新內容。
- 還原、封存或複製會恢復舊 externalId／排程並造成誤發布。
- JSON、版本、媒體或通知持續無上限成長。
- 正式環境缺少 HTTPS、Token 保護、Webhook 驗證或可用備份。

## 8. 完成定義

本計畫全部完成的定義如下：

1. `partial_success` 已從資料層、API 到所有主要 UI 一致支援。
2. Composer 具備可恢復 Autosave，且有 revision／版本衝突保護。
3. 貼文版本可查詢與還原；還原不會自動重新發布。
4. 貼文可封存、還原與複製，並有清楚的容量管理入口。
5. JSON、版本、發布紀錄、通知與媒體均有上限、封存與健康檢查。
6. 新增測試與原有測試全部通過，並完成桌面與手機回歸。
7. Meta 真實帳號與正式部署前置完成；若仍受外部審查阻擋，必須明確保留為外部阻擋，不得標記為程式完成。
8. 所有狀態文件與歷史規劃文件已同步，不再用過時 checklist 判斷目前完成度。

## 9. 建議下一個實作批次

（歷史快照）當時建議先做 P0 的 `partial_success`，再做 P1 的 Autosave；這些項目目前已完成並通過測試，後續依本文件最後的 Current implementation update 執行。
## Current implementation update (2026-08-14, v0.5.34)

This section is an additive status update. Earlier assessment notes remain above as historical records.

- P0 partial publish status is implemented and covered by the existing publish, calendar, composer, and insights flows.
- Composer autosave is implemented with an 800ms debounce, one in-flight save chain, optimistic `baseVersion` conflict protection, local recovery snapshots capped at 20 items and seven days, before-leave warning, retry action, and unsaved-content blocking for schedule/publish.
- Post version history is implemented without a database. Content snapshots are stored in monthly `data/post-versions/YYYY-MM.json` archives and include content, target overrides, media references, and platform settings while excluding credentials, publish attempts, external IDs, and transient errors.
- Version history is bounded to 20 active versions per post, autosave snapshots are throttled to 30 seconds, and monthly archives are retained for up to 24 months with a per-file record limit. Backup and restore now include the version archive directory.
- `GET /api/posts/:postId/versions`, `POST /api/posts/:postId/versions`, and `POST /api/posts/:postId/versions/:versionId/restore` are available. Restore creates a new draft version and resets target runtime state so it cannot republish with stale external IDs.
- Manual save, autosave, schedule, publish, restore, and create events are represented by a source label when a distinct content snapshot is created. Duplicate content does not create unbounded history.
- The Composer version history panel is responsive: actions wrap on narrow screens and restore controls remain touch-sized.
- Verification completed: `npm test` passes 160/160; targeted post, history-retention, and storage backup tests pass; changed JavaScript files pass `node --check`.

### Next planned work

- Add explicit archive/restore/duplicate post actions and lifecycle rules for user-facing post records.
- Add focused UI smoke coverage for version history restore and autosave recovery at 390px width when the browser harness is available.
- Continue production readiness work for Meta App Review, HTTPS media hosting, webhook deployment, and backup operations.
