# ShrineFlow 雲端部署 Runbook

## 目標

正式環境使用 Cloud Run 執行 Express API，Firestore 儲存資料，Cloudflare R2 儲存照片與影片，Cloud Scheduler 觸發 Instagram／Threads 到期發布。正式環境不依賴本機電腦、data/ 或 uploads/。

## 一次性準備

1. 建立 Firebase／Google Cloud project，啟用 Firestore Native mode。
2. 建立 Cloudflare R2 bucket shrineflow-media、API token 與公開自訂網域。
3. 建立 Secret Manager secrets：scheduler token、master key、R2 access key、R2 secret key、Gemini key；若使用 legacy 單一密碼模式，再建立 operator password 與 session secret。
4. 將 .firebaserc.example 複製為 .firebaserc，填入 project ID。
5. 依 deploy/cloud-run.env.example 補齊非 secret 環境變數與 R2 public URL。

## 建置與部署

Dockerfile 會以 Node 22 Alpine 建立 Cloud Run image。Cloud Run 服務名稱固定為 shrineflow-api，region 預設為 asia-east1，Firebase Hosting rewrite 已指向此服務。

    gcloud auth login
    firebase login
    gcloud config set project YOUR_PROJECT_ID
    gcloud services enable run.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com
    .\deploy\deploy-cloud.ps1 -ProjectId YOUR_PROJECT_ID -R2AccountId YOUR_CLOUDFLARE_ACCOUNT_ID -R2PublicBaseUrl https://media.example.com -FirebaseApiKey YOUR_FIREBASE_WEB_API_KEY -FirebaseAuthDomain YOUR_PROJECT_ID.firebaseapp.com -FirebaseAppId YOUR_FIREBASE_WEB_APP_ID -OwnerEmails owner@example.com -FirebaseProject YOUR_PROJECT_ID

Cloud Run 必須設定：

    NODE_ENV=production
    SHRINEFLOW_AUTH_MODE=firebase
    SHRINEFLOW_STORAGE_BACKEND=firestore
    SHRINEFLOW_MEDIA_BACKEND=r2
    SHRINEFLOW_SCHEDULER_MODE=cloud
    SHRINEFLOW_SCHEDULER_ALLOW_PLATFORM_AUTH=false
    FIRESTORE_PROJECT_ID=YOUR_PROJECT_ID
    R2_ACCOUNT_ID=YOUR_CLOUDFLARE_ACCOUNT_ID
    R2_BUCKET=shrineflow-media
    R2_ENDPOINT=https://YOUR_CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com
    R2_PUBLIC_BASE_URL=https://media.example.com
    PUBLIC_MEDIA_BASE_URL=https://media.example.com

Firebase 多人登入還必須設定 `FIREBASE_API_KEY`、`FIREBASE_AUTH_DOMAIN`、`FIREBASE_PROJECT_ID`、`FIREBASE_APP_ID`，以及至少一個 `SHRINEFLOW_OWNER_EMAILS` 或 `SHRINEFLOW_OWNER_UIDS`。Cloud Run 的執行服務帳號必須能使用 Firebase Admin Authentication；正式環境不要再綁定 legacy 的操作員密碼 Secret。

Firebase Console 也要啟用 Google sign-in 與 Email/Password provider，並將 Firebase Hosting 網域與正式網域加入 Authentication 的 Authorized domains；否則 Google 登入彈窗或 Email 登入都會被 Firebase 拒絕。Email 帳號需先在 Firebase Authentication 建立，ShrineFlow 只負責登入，不開放自行註冊。

若暫時使用單一操作員模式，將 `SHRINEFLOW_AUTH_MODE` 改為 `legacy`，並綁定 `SHRINEFLOW_OPERATOR_PASSWORD` 與 `SHRINEFLOW_SESSION_SECRET` 兩個 Secret。此模式只有一個共享身份，不能提供不同 Google 帳號的個別稽核身分。

Secret 透過 Cloud Run Secret Manager binding 注入，不要放進 Git。

## Cloud Scheduler jobs

建立三個 HTTP POST job，全部帶 header X-ShrineFlow-Scheduler-Token，值必須與 Cloud Run 的 SHRINEFLOW_SCHEDULER_TOKEN 相同。`cloud-scheduler.ps1` 可重複執行，已存在的 job 會更新：

| Job | Cron | Endpoint |
|---|---|---|
| publish-due-targets | 每分鐘 | /api/internal/scheduler/publish-due |
| export-firestore-backup | 每日 03:00 | /api/internal/scheduler/export-backup |
| cleanup-orphan-media | 每日 04:30 | /api/internal/scheduler/cleanup-media |

publish-due-targets 只負責 Instagram／Threads 的 ShrineFlow 排程；Facebook 原生排程仍由 Facebook API 管理。

## Firestore 資料搬遷

先在可讀取舊 data/ 的環境設定 Firestore project 與 Google Application Default Credentials，再執行：

    SHRINEFLOW_STORAGE_BACKEND=firestore
    FIRESTORE_PROJECT_ID=YOUR_PROJECT_ID
    GOOGLE_APPLICATION_CREDENTIALS=C:\secure\shrineflow-migration.json
    npm run migrate:firestore

搬遷完成後，用 Cloud Run 正式設定重新啟動服務。舊本機 data/ 與 uploads/ 必須先做離線備份，確認 Firestore 與 R2 可讀後才可封存。

## 驗證

- GET https://YOUR_HOST/api/system/readiness
- GET https://YOUR_HOST/api/healthz（Cloud Run 公開健康檢查，不需登入）
- GET https://YOUR_HOST/api/config
- 帶 scheduler token 呼叫三個 internal scheduler endpoint
- 上傳照片／影片後，確認 media path 是 /media/...，R2 object key 位於 original/{clientId}/{yyyy}/{mm}/{mediaId}/
- 建立一個 Instagram 或 Threads 未來排程，關閉本機電腦，確認 Cloud Scheduler 仍會觸發

## 回滾與安全

Cloud Run 可回滾到上一個 revision；Firestore 與 R2 不回滾。需要資料回復時先保留目前 revision，再依 R2 backup manifest 匯出指定 Firestore collection，驗證後才覆寫。

R2 bucket 維持 private；公開媒體使用自訂 public domain，upload 使用短效 presigned PUT。Cloud Run 設定 max instances，並建立 Google Cloud budget alert。
