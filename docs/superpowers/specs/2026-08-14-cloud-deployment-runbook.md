# ShrineFlow 雲端部署 Runbook

正式環境：Cloud Run 同時提供後台與 API，Firestore 存資料，Cloudflare R2 存媒體，Cloud Scheduler 每分鐘觸發 Instagram／Threads 到期發布。不依賴個人電腦、`data/` 或 `uploads/`。不要把 `/api` 接到 Firebase Hosting rewrite（Hosting 動態請求約 60 秒就會斷）。

免費層原則：Cloud Run `min-instances=0`、`max-instances=1`；Cloud Scheduler 固定 3 個 job；R2 用公開自訂網域、bucket 維持 private。Google Cloud 仍要開 billing，但此設定走免費額度優先。

## 你要先有的東西

腳本建不了 Cloudflare 帳號。機器到位後，只需要這批一次性資料：

1. Google Cloud／Firebase project，billing 已開。
2. Cloudflare R2 bucket `shrineflow-media`、API token（Access Key + Secret）、**HTTPS 公開網域**（不要用 `r2.dev` 當正式媒體網址）。
3. Firebase Authentication 啟用 Google 登入；Authorized domains 加入 Cloud Run 網域。
4. 把 R2 Access Key／Secret 放進 Secret Manager：

```powershell
# 在專案目錄，先登入
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# 只在第一次建立。把 YOUR_R2_ACCESS_KEY / YOUR_R2_SECRET_KEY 換成 Cloudflare 給的值。
echo YOUR_R2_ACCESS_KEY | gcloud secrets create shrineflow-r2-access-key --data-file=-
echo YOUR_R2_SECRET_KEY | gcloud secrets create shrineflow-r2-secret-key --data-file=-
```

Gemini Key 可以現在做成 `shrineflow-gemini-key`，也可以部署後在後台設定頁填；後台會寫進 Firestore，重啟不會丟。

## 丟上去

第一次（或服務還不存在）在專案根目錄執行完整參數。之後日常更新**只需** `-ProjectId`：跳過 IAM／開 API／Scheduler，用 Kaniko 層快取建 image（`package-lock.json` 沒變就不會重跑 `npm ci`）。

```powershell
# 第一次，或改 IAM／Secret／Scheduler
.\deploy\deploy-cloud.ps1 `
  -ProjectId YOUR_PROJECT_ID `
  -R2AccountId YOUR_CLOUDFLARE_ACCOUNT_ID `
  -R2PublicBaseUrl https://media.example.com `
  -FirebaseApiKey YOUR_FIREBASE_WEB_API_KEY `
  -FirebaseAuthDomain YOUR_PROJECT_ID.firebaseapp.com `
  -FirebaseAppId YOUR_FIREBASE_WEB_APP_ID `
  -OwnerEmails you@example.com

# 日常（服務已存在）
.\deploy\deploy-cloud.ps1 -ProjectId YOUR_PROJECT_ID
```

已存在的服務再部署時：只建 cached image 並換 Cloud Run revision，沿用現有 env／Secret。改環境變數加 `-UpdateConfig`（仍要 R2／Firebase 參數）。重做 IAM／API 加 `-Bootstrap`。只刷新 Scheduler 加 `-UpdateScheduler`。

第一次會：啟用 API、沒有 Firestore 就建立 Native database、建立 Artifact Registry `shrineflow`、沒有 scheduler／master key Secret 就自動產生、給 Cloud Run 服務帳號 Firestore 權限、部署 `shrineflow-api`、建立 3 個 Scheduler job。缺 R2 Secret 會直接停並講缺哪一個。從舊的 `--source` 部署切過來時，先跑一次帶完整參數的指令（或 `-Bootstrap`）以建立 Registry。

部署完成後，用腳本印出的 Cloud Run URL 開後台。

## 後台第一次設定

1. 用 Owner Email 的 Google 帳號登入。
2. 設定頁填 Gemini API Key 並測試連線。
3. 建立品牌，填 Facebook／Instagram／Threads Token 並測試連線。
4. 開 `https://YOUR_CLOUD_RUN_URL/api/system/readiness`，`blocked` 不能當正式；`warning` 逐項看。
5. 上傳一張圖，確認路徑是 `/media/...`。發 Instagram／Threads 前，確認 R2 公開網域用 HTTPS 能直接打開該檔。

品牌平台 Token 與 Gemini Key 都存在 Firestore（Token 另以 `SHRINEFLOW_MASTER_KEY` 加密）。不要指望 Cloud Run 容器裡的 `.env` 還在下一次冷啟動活著。

## Cloud Scheduler

三個 HTTP POST job，header `X-ShrineFlow-Scheduler-Token` 必須與 Secret `shrineflow-scheduler-token` 相同。`deploy-cloud.ps1` 會一併建立；也可單獨跑 `deploy/cloud-scheduler.ps1`。

| Job | Cron | Endpoint |
|---|---|---|
| publish-due-targets | 每分鐘 | `/api/internal/scheduler/publish-due` |
| export-firestore-backup | 每日 03:00 | `/api/internal/scheduler/export-backup` |
| cleanup-orphan-media | 每日 03:30 | `/api/internal/scheduler/cleanup-media` |

`publish-due-targets` 只發 Instagram／Threads 的 ShrineFlow 排程。Facebook 原生排程仍由 Facebook 管理。

## 本機資料搬上雲（合併，非覆蓋）

Google 登入只驗證身分，不搬品牌／排程／發布日誌。跨裝置同步必須把本機 JSON／uploads 合併進 Firestore／R2，之後 PC、手機都固定使用同一個 Cloud Run URL。

### 原則

- 只新增或更新，不會因本機缺少紀錄而刪除 Firestore 資料。
- 同 ID 且內容不同：先比 `updatedAt`，再比 `createdAt`／`occurredAt`；時間戳相同、缺失或無法解析 → blocking conflict，不自動寫入。
- 預設只產生 plan；`--apply` 前會再驗 Firestore fingerprint，掃描後若雲端已變會拒絕套用。
- 品牌 Token：用 `SHRINEFLOW_SOURCE_MASTER_KEY`（本機）解密，再用 `SHRINEFLOW_TARGET_MASTER_KEY`（Cloud Run 的 `SHRINEFLOW_MASTER_KEY`）重加密。兩者可不同。

### 步驟

1. 停止本機與雲端編輯；備份整個 `data/`、`uploads/`。
2. 若雲端已有資料，先觸發一次 Firestore→R2 backup（Scheduler `export-firestore-backup` 或手動打內部端點）。
3. 產生媒體 plan（不寫入）：

```powershell
$env:SHRINEFLOW_STORAGE_BACKEND='firestore'
$env:FIRESTORE_PROJECT_ID='YOUR_PROJECT_ID'
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\secure\shrineflow-migration.json'
# 另設 R2_* 與 PUBLIC_MEDIA_BASE_URL
npm run migrate:media:plan
```

4. 產生資料 merge plan（可帶媒體 mapping）：

```powershell
$env:SHRINEFLOW_SOURCE_MASTER_KEY='(本機 master key，可省略則用 SHRINEFLOW_MASTER_KEY)'
$env:SHRINEFLOW_TARGET_MASTER_KEY='(Cloud Run master key)'
npm run migrate:firestore:plan -- --media-mapping data\backups\media-plan-XXXX.json
```

若暫時無法連 Firestore，可先用本機對空雲端演練：

```powershell
npm run migrate:firestore:plan -- --remote-empty
```

5. 打開 plan JSON：確認每集合 `create/update/keep/conflict`，**blocking conflict 必須為 0**。
6. Apply 順序：

```powershell
npm run migrate:media:r2 -- --apply --plan-file data\backups\media-plan-XXXX.json
npm run migrate:firestore -- --apply --plan-file data\backups\merge-plan-XXXX.json
```

7. 再跑一次 `--plan`；理想狀態只剩 `keep`。
8. PC、手機都改開同一個 Cloud Run URL，用同一 Google 帳號驗收品牌、草稿、排程、發布日誌、媒體。

舊 `data/` 與 `uploads/` 確認雲端可讀後再封存，不要刪到無法回滾。

### 回滾

- Cloud Run revision 回滾 ≠ 資料回滾。
- 資料回復：用遷移前 R2 內 Firestore backup manifest。
- R2 新增物件：依 media plan 的 `objectKey` 清單清理。

## 驗證

- `GET /api/healthz`
- `GET /api/system/readiness`
- 後台登入、存 Gemini、存品牌 Token、上傳媒體、立即發布
- 建一個 Instagram 或 Threads 未來排程，關個人電腦，確認仍會發

## 回滾

Cloud Run 可回上一版 revision。Firestore 與 R2 不隨 revision 回滾。需要資料回復時，用 R2 裡的 Firestore backup manifest。

## 花不到錢仍會擋的外部條件

Meta App Review／Business Verification 沒過時，正式粉專／IG 專業帳號可能被平台拒發。這不是 ShrineFlow 後台能解。開發者／測試者帳號可以先測。
