# ShrineFlow 雲端部署、資料庫與媒體儲存架構規格

> 日期：2026-08-14  
> 文件狀態：規劃完成，**v0.5.67 已落地可部署**（Cloud Run 單一入口、Firestore、R2、Cloud Scheduler）。操作步驟見 `2026-08-14-cloud-deployment-runbook.md`。  
> 適用基線：ShrineFlow v0.5.x  
> 目標：個人電腦關機後，後台、資料與發布排程仍能在雲端正常運作

## 0. 本文件範圍

本文件只定義後續實作方向，不在本階段建立雲端資源或修改程式。

規劃範圍：

- 後台前端放置位置
- Node.js / Express 後端放置位置
- 貼文、排程、平台連線與發布紀錄的資料庫
- 照片、影片與縮圖的物件儲存
- Facebook 原生排程與 Instagram／Threads 雲端排程
- 登入、Token 與機密資料保護
- 備份、失敗重試與重複發布防護
- 從本機 JSON / `uploads/` 搬遷至雲端的階段與驗收標準

非本階段範圍：

- 不立即實作
- 不建立 Google Cloud、Firebase 或 Cloudflare 帳號／資源
- 不變更目前本機執行方式
- 不新增多人審核、角色權限矩陣或企業級 SLA

## 1. 已確認的產品需求

1. 正式上線後不可依賴個人電腦持續開機。
2. 一個月後的排程也必須由雲端準時處理。
3. Facebook 貼文／Reel 優先使用 Facebook 平台原生排程。
4. Instagram／Threads 公開 API 未提供與 Facebook 相同的未來發布時間介面，因此由 ShrineFlow 雲端排程器到期呼叫發布 API。
5. 資料不可再以單一主機上的 `data/*.json` 作為正式資料來源。
6. 照片與影片不可放在 Cloud Run 暫存磁碟，也不可存成 Base64 塞進資料庫。
7. 現階段仍以單一操作員為主，但上線後必須先登入才能使用後台。
8. 免費額度優先，但不得為了免費而採用會造成排程漏發的休眠式架構。

## 2. 推薦架構決策

| 層級 | 推薦服務 | 放置內容 | 決策原因 |
|---|---|---|---|
| 後台前端 | Firebase Hosting | `public/` HTML、CSS、JavaScript | 適合目前靜態前端，與 Firebase Auth 整合容易 |
| 後端 API | Google Cloud Run | Node.js、Express、Gemini、Meta API adapters | 可保留現有技術堆疊，適合較長的 AI 與影片請求 |
| 資料庫 | Cloud Firestore | 貼文、target、排程、平台連線、紀錄 | Serverless、無每週閒置暫停，資料模型接近目前 JSON |
| 媒體儲存 | Cloudflare R2 | 圖片、影片、縮圖、資料匯出備份 | 物件儲存、免費額度較適合媒體、對外傳輸免費 |
| 發布排程 | Google Cloud Scheduler | 每分鐘觸發排程處理端點 | 不依賴 Cloud Run 常駐，也不依賴個人電腦 |
| 使用者登入 | Firebase Authentication | Google 登入、操作員白名單 | 現階段單人使用，實作與維護成本低 |
| 機密設定 | Cloud Run Secret / 環境機密 | Gemini key、R2 key、加密主金鑰 | 不提交 Git、不回傳瀏覽器 |
| 程式碼 | GitHub 私有 repository | 原始碼、部署設定、migration | 程式碼版控，不保存媒體與正式 Token |

不採用 Render Free + Supabase Free 作正式排程主體，原因是免費方案存在休眠、暫停或暫存磁碟限制。

不以全 Cloudflare Workers 作為第一版，原因是目前 ShrineFlow 仍包含 Express、Gemini 媒體分析、Facebook 圖片／影片上傳與 Node.js 相依；直接搬入 Workers Free 會帶來較大的重寫與 CPU 限制風險。

## 3. 目標拓撲

```text
使用者瀏覽器
  |
  +--> Firebase Hosting
  |      - HTML / CSS / JavaScript
  |      - Firebase Auth 登入
  |
  +--> Cloud Run API
         - 驗證 Firebase ID Token
         - Composer / Posts / Targets API
         - Gemini 生成
         - Facebook / Instagram / Threads 發布
         - R2 簽名網址產生
         |
         +--> Firestore
         |      - 結構化資料、排程、狀態、發布紀錄
         |
         +--> Cloudflare R2
         |      - 圖片、影片、縮圖、備份
         |
         +--> Meta / Gemini APIs

Cloud Scheduler
  |
  +-- 每分鐘使用 OIDC 呼叫 Cloud Run 內部排程端點
```

Firebase Hosting 只負責靜態前端。耗時 API 不透過 Hosting rewrite，以免受到 Hosting 動態請求逾時限制；前端直接呼叫 Cloud Run API，並只允許指定 Hosting 網域的 CORS。

## 4. 環境與區域

建議：

- Google Cloud region：`asia-east1`（台灣）
- Firestore location：與 Cloud Run 相同或官方建議的鄰近位置
- 應用預設時區：`Asia/Taipei`
- 資料庫時間：一律保存 UTC timestamp
- 前端顯示：依 client 的 timezone 轉換
- Cloud Run：request-based billing、`min-instances=0`
- Cloud Run：第一階段限制 `max-instances=1`，降低意外費用；排程仍需具備交易鎖與 idempotency，不能只依賴單實例

Cloud Run 縮到零不等於排程停止。Cloud Scheduler 會在每次執行時喚醒服務；冷啟動可能造成數秒級延遲，但不需要個人電腦或常駐 Node 程序。

## 5. Firestore 資料模型

依 ShrineFlow 內容流程規範，正式資料必須拆分為：

```text
Post
  -> Post Target
       -> Publish Attempt
```

不再另外維護一份容易與貼文 target 不同步的正式 `schedule.json`。

### 5.1 `clients`

保存品牌／客戶設定：

- `id`
- `name`
- `notes`
- `profile`
- `defaultTimezone`
- `createdAt`
- `updatedAt`
- `archivedAt`

### 5.2 `platformAccounts`

保存平台連線的非機密識別資訊：

- `id`
- `clientId`
- `platformId`
- `displayName`
- `remoteAccountId`
- `status`
- `credentialCiphertext`
- `credentialIv`
- `credentialKeyVersion`
- `lastVerifiedAt`
- `lastVerificationError`
- `createdAt`
- `updatedAt`

平台 Token 不得明文保存。使用應用層 AES-GCM 加密，主金鑰只放在 Cloud Run 的機密設定中。

### 5.3 `posts`

保存共用母稿：

- `id`
- `clientId`
- `internalTitle`
- `subject`
- `contentGoal`
- `audience`
- `tone`
- `keyPoints`
- `callToAction`
- `baseContent`
- `campaignId`
- `status`
- `version`
- `createdAt`
- `updatedAt`
- `archivedAt`

`posts` 不保存平台發布狀態；平台狀態放在 `postTargets`。

### 5.4 `postTargets`

每一個平台帳號／格式是一個獨立 target：

- `id`
- `postId`
- `clientId`
- `platformAccountId`
- `platformId`
- `contentType`
- `enabled`
- `copyMode`
- `copyOverride`
- `hashtagsOverride`
- `contentSettings`
- `timezone`
- `scheduleMode`
- `scheduledAt`
- `status`
- `remoteId`
- `remoteUrl`
- `idempotencyKey`
- `attemptCount`
- `lastAttemptAt`
- `nextAttemptAt`
- `leaseId`
- `leaseExpiresAt`
- `publishedAt`
- `lastError`
- `createdAt`
- `updatedAt`

`scheduleMode`：

- `platform_native`：已交給平台原生排程，目前用於支援的 Facebook 內容
- `cloud_scheduler`：由 ShrineFlow 雲端到期發布，目前用於 Instagram／Threads
- `none`：草稿或立即發布

Firestore 必要索引：

- `status + scheduledAt`
- `status + nextAttemptAt`
- `clientId + updatedAt`
- `postId + platformId`
- `platformAccountId + status`

### 5.5 `mediaAssets`

只保存媒體 metadata，不保存二進位內容：

- `id`
- `clientId`
- `storageProvider`
- `bucket`
- `objectKey`
- `originalName`
- `mimeType`
- `sizeBytes`
- `checksumSha256`
- `width`
- `height`
- `durationMs`
- `status`
- `thumbnailObjectKey`
- `createdAt`
- `updatedAt`
- `deletedAt`

不得保存永久 signed URL；signed URL 必須在需要時由 `objectKey` 動態產生。

### 5.6 `postMedia`

保存貼文／target 與媒體的關聯：

- `id`
- `postId`
- `targetId`，共用媒體時為 `null`
- `mediaAssetId`
- `sortOrder`
- `altText`
- `createdAt`

### 5.7 `publishAttempts`

每次立即發布、排程發布與重試都建立獨立 attempt：

- `id`
- `postId`
- `targetId`
- `platformId`
- `source`
- `status`
- `idempotencyKey`
- `startedAt`
- `finishedAt`
- `remoteId`
- `errorCategory`
- `errorCode`
- `errorMessage`
- `retriable`
- `responseSummary`

完整紀錄不得長期塞在 `postTargets` 文件內，避免文件持續膨脹。

### 5.8 其他 collections

- `templates`
- `campaigns`
- `settings`：只保存非機密設定
- `auditEvents`
- `schemaMigrations`
- 現有 `gods.json` 對應的主題／preset collection，名稱於 migration 實作前依當時產品命名確認

## 6. 發布與排程規則

### 6.1 Facebook 原生排程

支援的 Facebook 貼文／Reel：

```text
使用者確認排程
  -> Cloud Run 立即呼叫 Facebook API
  -> 圖片／影片與未來時間立即交給 Facebook
  -> Facebook 回傳 remoteId
  -> postTarget.scheduleMode = platform_native
  -> postTarget.status = scheduled
```

到期時不由 ShrineFlow 再發布一次。`remoteId` 是防止本機／雲端排程器重複接管的重要條件。

改時間：

- 依平台 API 能力取消舊排程後建立新排程
- 新排程成功後才更新本地 target
- 若舊排程已取消但新排程失敗，target 必須標記 `failed`，不可顯示仍排程成功

取消：

- 先取消平台端排程
- 成功後再清除本地 `scheduledAt`、`remoteId`

Facebook 限時動態維持平台能力檢查，不假設可原生排程。

### 6.2 Instagram／Threads 雲端排程

```text
使用者確認排程
  -> Firestore 保存 scheduledAt
  -> postTarget.scheduleMode = cloud_scheduler
  -> postTarget.status = scheduled

Cloud Scheduler 每分鐘觸發
  -> 查詢 scheduledAt <= now 的 target
  -> Firestore transaction 重新確認狀態
  -> 建立 lease 並切換 publishing
  -> 建立 publishAttempt
  -> 產生短效 R2 讀取網址
  -> 呼叫 Instagram／Threads 發布 API
  -> published 或 retrying / failed
```

### 6.3 排程狀態機

```text
draft
  -> scheduled
  -> publishing
  -> published

publishing
  -> retrying
  -> publishing
  -> published / failed

scheduled
  -> cancelled / draft
```

### 6.4 到期 claim 與重複發布防護

Cloud Scheduler、Cloud Run 與網路都可能重送請求，因此不得用「只有一台 server」當防重複機制。

每個到期 target 必須：

1. 使用 Firestore transaction 重新讀取 target。
2. 確認狀態仍為 `scheduled` 或可重試的 `retrying`。
3. 確認 `scheduledAt` / `nextAttemptAt <= now`。
4. 寫入唯一 `leaseId` 與 `leaseExpiresAt`。
5. 將狀態切換為 `publishing`。
6. 使用穩定的 `idempotencyKey` 建立 attempt。
7. 同一 target、同一排程版本不得建立第二個有效發布 attempt。

如果 worker 在發布途中中斷，lease 到期後可以重新接管，但必須先依平台 remote ID 或 request 狀態判斷是否已發布。

### 6.5 逾期排程

第一階段沿用目前「恢復後補發布」的產品行為：

- 下一次 tick 撿取逾期 target
- 立即發布
- attempt 紀錄 `lateBySeconds`
- 後台顯示實際發布時間與延遲

後續可新增 client 級設定：超過指定時間後改標記 `missed`，不自動補發。

### 6.6 重試策略

第一階段：

- 最多 3 次
- 暫時性錯誤使用指數退避
- 建議間隔：1 分鐘、2 分鐘、4 分鐘
- 驗證、權限、Token、格式與永久 media 錯誤不自動重試
- 每次重試建立新的 `publishAttempt`
- 手動重試也必須產生 attempt 與 audit event

錯誤分類：

- `validation`
- `authentication`
- `permission`
- `rate_limit`
- `media`
- `network`
- `provider`
- `unknown`

## 7. Cloud Scheduler 工作

免費額度內規劃三個 job：

| Job | 頻率 | 功能 |
|---|---|---|
| `publish-due-targets` | 每分鐘 | 發布到期 Instagram／Threads、處理 retry |
| `export-firestore-backup` | 每週 | 將重要 collections 匯出為 JSON 寫入 R2 |
| `cleanup-orphan-media` | 每日 | 清除超過保留期且未被引用的媒體 |

排程端點必須使用 Cloud Scheduler OIDC service account 驗證，不接受一般 Firebase 使用者 Token，也不可用固定 query string 當唯一驗證。

建議端點：

```text
POST /internal/scheduler/publish-due
POST /internal/scheduler/export-backup
POST /internal/scheduler/cleanup-media
```

## 8. R2 媒體儲存

### 8.1 Bucket 與 object key

正式 bucket 預設 private：

```text
shrineflow-media/
  original/{clientId}/{yyyy}/{mm}/{mediaId}/{safeFilename}
  thumbnails/{clientId}/{mediaId}.webp
  generated/{clientId}/{mediaId}/{variantName}
  backups/firestore/{yyyy}/{mm}/{dd}/
```

R2 bucket 不開啟可列目錄功能。正式環境不使用 `r2.dev` 當公開媒體主網址。

### 8.2 瀏覽器直接上傳

```text
1. 前端向 Cloud Run 要求 upload session
2. Cloud Run 驗證 Firebase 使用者、檔名、MIME、大小
3. Cloud Run 產生短效 presigned PUT URL
4. 瀏覽器直接上傳到 R2
5. 前端呼叫 finalize API
6. Cloud Run HEAD 驗證 R2 object
7. 寫入 mediaAssets
```

R2 Access Key / Secret 不得送到瀏覽器。presigned URL 必須限制：

- 單一 object key
- PUT 操作
- 短效期限，建議 10～15 分鐘
- Content-Type
- 允許來源 CORS

### 8.3 預覽與平台發布

後台預覽：

- 產生短效 GET URL
- 不在 Firestore 保存完整 signed URL

Instagram／Threads 發布：

- 到期時產生新的 signed GET URL
- URL 效期須涵蓋平台下載與影片處理時間，初期建議 24 小時
- 發布完成後不立即刪除原始媒體

Facebook 原生排程：

- 建立排程時就將媒體交給 Facebook
- R2 保留原始檔作為素材庫與重新發布來源
- publisher adapter 後續需從「本機 file path」改為支援 R2 stream 或平台可接受的 remote URL

### 8.4 媒體刪除

- UI 刪除先寫 `deletedAt`，不立即刪除 object
- 若仍被 post／target 引用，不允許實體刪除
- 無引用且超過 30 天才由 cleanup job 刪除
- 刪除完成寫 audit event

## 9. 後台與 API

### 9.1 Firebase Hosting

- 只部署 `public/` 靜態檔案
- 保留目前原生 HTML / CSS / JavaScript，不導入 React/Vue
- 使用免費 `web.app` 網址即可測試
- 正式網域後續再決定，不是第一階段阻塞條件

### 9.2 Cloud Run

- 保留 Node.js + Express
- 新增 container / deployment 設定
- 不使用本機磁碟保存任何正式資料
- 暫存檔只允許存在請求生命週期內
- 啟動時不得依賴寫入 `data/` 或 `uploads/`
- 提供 `/healthz` 與 `/readyz`
- 允許來源只包含 Firebase Hosting 與正式自訂網域
- 長時間 AI／影片 API 直接呼叫 Cloud Run，不經 Firebase Hosting rewrite

### 9.3 API 邊界

建議新增／調整：

```text
POST /api/media/upload-session
POST /api/media/finalize
GET  /api/media/:id/view-url
DELETE /api/media/:id

POST /api/schedules
PATCH /api/schedules/:targetId
DELETE /api/schedules/:targetId

POST /api/publish/:targetId
POST /api/publish/:targetId/retry

POST /internal/scheduler/publish-due
POST /internal/scheduler/export-backup
POST /internal/scheduler/cleanup-media
```

既有 API 路徑可在實作時維持相容，優先替換底層 repository / media adapter，避免一次重寫前端。

## 10. 登入與機密

### 10.1 操作員登入

- Firebase Authentication Google Sign-in
- 後端驗證 Firebase ID Token
- 除驗證成功外，還要比對允許的 email / UID 白名單
- 第一階段只有 `admin` 操作員
- 所有寫入 API 記錄 actor UID / email

### 10.2 機密資料

下列值不得提交 Git 或回傳前端：

- Gemini API key
- Meta App secret
- Facebook Page token
- Instagram token
- Threads token
- R2 Access Key / Secret
- credential encryption master key

每個平台帳號 Token 加密後可存 Firestore；加密主金鑰只存在 Cloud Run Secret／環境機密。

### 10.3 內部排程驗證

- Cloud Scheduler 使用 OIDC service account
- `/internal/**` 驗證 issuer、audience 與 service account identity
- 不共用一般使用者登入流程
- 不使用容易外洩的固定 URL secret 作唯一防護

## 11. 備份與復原

Firestore 免費額度不包含完整受管理備份／PITR，因此第一階段實作應提供應用層匯出：

```text
每週 Cloud Scheduler
  -> Cloud Run 讀取重要 collections
  -> 產生帶 schemaVersion 的 NDJSON / JSON
  -> 寫入 R2 backups/firestore/{date}/
  -> 保存 manifest、筆數與 checksum
```

至少匯出：

- clients
- platformAccounts（保留加密 ciphertext，不匯出主金鑰）
- posts
- postTargets
- mediaAssets
- postMedia
- publishAttempts
- templates
- campaigns
- settings

復原工具必須在正式切換前做一次演練，確認可匯入到新的 Firestore project。

## 12. 免費額度基線

截至 2026-08-14 的規劃基線：

| 服務 | 免費額度重點 | ShrineFlow 預估 |
|---|---|---|
| Cloud Run | 每月 200 萬次 requests，另有 CPU / RAM 免費額度 | 每分鐘 scheduler 約 43,200 次／月，加後台使用仍低於額度 |
| Cloud Scheduler | 每帳單帳號每月 3 個 jobs 免費 | 規劃剛好使用 3 個 |
| Firestore | 1 GiB、每日 50,000 reads、20,000 writes、20,000 deletes | 每分鐘空查詢約 1,440 reads／日，仍有空間 |
| Cloudflare R2 | 每月 10 GB-month、100 萬 Class A、1,000 萬 Class B，對外傳輸免費 | 圖片充足；影片需監控容量 |
| Firebase Auth | 一般登入免費額度遠高於單一操作員需求 | 足夠 |
| Firebase Hosting | 有免費靜態 Hosting 額度 | 後台靜態資源預期足夠 |

參考：

- Cloud Run pricing：<https://cloud.google.com/run/pricing>
- Cloud Scheduler pricing：<https://cloud.google.com/scheduler/pricing>
- Firestore quotas：<https://firebase.google.com/docs/firestore/quotas>
- R2 pricing：<https://developers.cloudflare.com/r2/pricing/>
- R2 presigned URLs：<https://developers.cloudflare.com/r2/api/s3/presigned-urls/>

Google Cloud Run 需要啟用 billing account；免費額度不是硬性費用上限。實作時必須：

- 設定 Google Cloud budget alerts
- 限制 Cloud Run max instances
- 設定 request timeout
- 監控 Firestore reads / writes
- 監控 R2 儲存量
- 不允許前端直接任意建立大量排程或上傳 session

免費層沒有正式 SLA；若 ShrineFlow 成為客戶依賴的正式商業服務，應將付費方案列入營運成本，而不是以免費層作永久可靠性承諾。

## 13. 實作階段

### Phase 0：雲端帳號與環境

- 建立 Google Cloud / Firebase project
- 啟用 Cloud Run、Firestore、Scheduler、Authentication
- 建立 Cloudflare R2 bucket
- 設定 dev / production 環境變數與 secret
- 設定 budget alerts

### Phase 1：Repository 抽象層

- 建立 Post、Target、Client、Template、Campaign repositories
- 保留 local JSON adapter 供本機 migration／回歸測試
- 新增 Firestore adapter
- route 不再直接呼叫 `readJson` / `mutateJson`
- 新增 schemaVersion 與 migration runner

### Phase 2：R2 媒體

- 建立 media storage interface
- 實作 presigned upload session
- 實作 finalize / HEAD validation
- 將前端上傳改為直接傳 R2
- publisher adapter 支援 R2 URL / stream
- 保留 local media adapter 供測試

### Phase 3：雲端排程

- 將目前本機 scheduler 核心抽成可單次執行的 service
- 新增 Firestore transaction claim / lease
- 新增 Cloud Scheduler OIDC 端點
- production 設定停用 `setInterval()`
- Facebook 原生排程維持不被雲端 scheduler 重複接管
- Instagram／Threads 改由 scheduler tick 發布

### Phase 4：登入與安全

- Firebase Google Sign-in
- admin email / UID 白名單
- API Token 驗證 middleware
- 平台 credential 加密 migration
- CORS、rate limiting 與 audit events

### Phase 5：部署

- 建立 Cloud Run container / deploy 設定
- Firebase Hosting 部署設定
- 設定 health checks
- 設定 Scheduler 三個 jobs
- 設定 logs 與錯誤通知

### Phase 6：資料遷移

- 備份現有 `data/` 與 `uploads/`
- 匯入 clients、posts、targets、templates、campaigns
- 上傳本機媒體至 R2
- 建立 mediaAssets / postMedia 對照
- 驗證筆數、object checksum 與引用完整性
- 切換 production storage backend

### Phase 7：驗收與切換

- 測試立即發布
- 測試 Facebook 原生排程／改期／取消
- 測試 Instagram／Threads 雲端排程／重試
- 關閉個人電腦後驗證排程
- 驗證逾期補發布
- 驗證重複 Scheduler request 不會重複貼文
- 驗證 R2 signed URL 可供平台成功抓取圖片與影片
- 驗證備份匯出與還原

## 14. 驗收標準

- [ ] 個人電腦關機後，Firebase Hosting 後台仍可登入。
- [ ] 個人電腦關機後，Instagram／Threads 排程仍可由雲端執行。
- [ ] Facebook 原生排程不會被 ShrineFlow 到期時重複發布。
- [ ] Cloud Run 重啟、縮到零或部署新版本不會遺失資料與媒體。
- [ ] 正式資料不再依賴 `data/*.json`。
- [ ] 正式媒體不再依賴 `uploads/`。
- [ ] 所有 target 狀態都能對應到一筆或多筆 publish attempt。
- [ ] 相同 scheduler tick 重送兩次不會產生兩篇貼文。
- [ ] 排程延遲與失敗原因可在後台查看。
- [ ] Token 不會出現在前端 response、HTML、Git 或一般 log。
- [ ] 圖片與影片由 R2 提供，資料庫只保存 metadata / object key。
- [ ] 一週備份可以匯入另一個測試 Firestore project。

## 15. 主要風險

### 免費額度與 SLA

- 免費額度可能調整。
- Cloud Run / Firestore 啟用 billing 後，超額可能產生費用。
- budget alert 只會通知，不一定自動停止服務。

### Meta 平台能力

- App Review、Business Verification、Token 權限與有效期仍可能阻擋正式發布。
- Instagram／Threads 使用公開 API 立即發布，因此雲端 scheduler 是必要元件。
- Facebook 各內容格式的原生排程能力需按當時 Graph API 版本重新驗證。

### 影片

- 大影片會快速消耗 R2 10 GB 免費空間。
- 平台處理影片可能超過短效 URL 時間，實作時需依實測調整效期。
- Facebook 上傳若需由 Cloud Run 轉送 binary，可能增加處理時間與網路費用；應優先研究平台支援的 remote URL / resumable upload 流程。

### Firestore

- Firestore 是文件資料庫，不能照搬 SQL join 思維。
- `postTargets` 必須維持可直接查詢，不能全部巢狀塞進 `posts`。
- attempt 歷史必須獨立 collection，避免文件大小與寫入衝突。

### 跨雲供應商

- Google Cloud 與 Cloudflare 之間會增加設定與監控面。
- 優點是 R2 媒體傳輸成本低，並讓 Firestore 備份保存在另一供應商。

## 16. 實作前確認清單

開始實作前須再次確認：

- [ ] 使用者已建立 Google Cloud / Firebase project。
- [ ] 使用者已建立 Cloudflare R2 bucket。
- [ ] 是否已有正式網域；沒有也可先用平台預設網址。
- [ ] 允許登入的 Google email / UID。
- [ ] 圖片與影片單檔上限。
- [ ] 逾期多久仍自動補發布。
- [ ] Facebook、Instagram、Threads 正式帳號與 App Review 狀態。
- [ ] 當時官方免費額度與 API 能力是否改變。
- [ ] 實作分支與當時 `package.json` 版號。

## 17. 下一個建置目標

使用者明確下達開始實作指令後，第一個建置目標為：

> 建立不影響現有本機功能的 repository / media adapter 邊界，讓 routes 不再直接依賴 JSON 檔與本機檔案路徑。

第一階段不直接切換正式資料，先完成介面、local adapter 與回歸測試，再逐步加入 Firestore 和 R2 adapter。每個重要實作階段均須依 `AGENTS.md` 同步更新版本號，但不得自動 commit。
