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

在專案根目錄執行：

```powershell
.\deploy\deploy-cloud.ps1 `
  -ProjectId YOUR_PROJECT_ID `
  -R2AccountId YOUR_CLOUDFLARE_ACCOUNT_ID `
  -R2PublicBaseUrl https://media.example.com `
  -FirebaseApiKey YOUR_FIREBASE_WEB_API_KEY `
  -FirebaseAuthDomain YOUR_PROJECT_ID.firebaseapp.com `
  -FirebaseAppId YOUR_FIREBASE_WEB_APP_ID `
  -OwnerEmails you@example.com
```

腳本會：啟用 API、沒有 Firestore 就建立 Native database、沒有 scheduler／master key Secret 就自動產生、給 Cloud Run 服務帳號 Firestore 權限、部署 `shrineflow-api`、建立 3 個 Scheduler job。缺 R2 Secret 會直接停並講缺哪一個。

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

## 本機資料搬上雲

```powershell
$env:SHRINEFLOW_STORAGE_BACKEND='firestore'
$env:FIRESTORE_PROJECT_ID='YOUR_PROJECT_ID'
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\secure\shrineflow-migration.json'
npm run migrate:firestore
npm run migrate:media:r2
```

舊 `data/` 與 `uploads/` 先離線備份，確認 Firestore 與 R2 可讀再封存。

## 驗證

- `GET /api/healthz`
- `GET /api/system/readiness`
- 後台登入、存 Gemini、存品牌 Token、上傳媒體、立即發布
- 建一個 Instagram 或 Threads 未來排程，關個人電腦，確認仍會發

## 回滾

Cloud Run 可回上一版 revision。Firestore 與 R2 不隨 revision 回滾。需要資料回復時，用 R2 裡的 Firestore backup manifest。

## 花不到錢仍會擋的外部條件

Meta App Review／Business Verification 沒過時，正式粉專／IG 專業帳號可能被平台拒發。這不是 ShrineFlow 後台能解。開發者／測試者帳號可以先測。
