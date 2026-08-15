param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [string]$Region = 'asia-east1',
  [string]$ServiceName = 'shrineflow-api',
  [string]$Image = '',
  [ValidateSet('firebase', 'legacy')] [string]$AuthMode = 'firebase',
  [Parameter(Mandatory = $true)] [string]$R2AccountId,
  [string]$R2Bucket = 'shrineflow-media',
  [Parameter(Mandatory = $true)] [string]$R2PublicBaseUrl,
  [string]$R2Endpoint = '',
  [string]$FirestoreDatabaseId = '(default)',
  [string]$GeminiModel = 'gemini-3.6-flash',
  [string]$GeminiFallbackModels = 'gemini-2.5-flash',
  [string]$FirebaseApiKey = '',
  [string]$FirebaseAuthDomain = '',
  [string]$FirebaseAppId = '',
  [string]$OwnerEmails = '',
  [string]$OwnerUids = '',
  [switch]$EnableMetaWebhook,
  [switch]$SkipScheduler
)

$ErrorActionPreference = 'Stop'

function Assert-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "找不到必要指令：$name。請先安裝並登入對應 CLI。"
  }
}

function Invoke-Gcloud {
  & gcloud @args
  if ($LASTEXITCODE -ne 0) {
    throw ("gcloud 失敗：" + ($args -join ' '))
  }
}

function Test-GcloudSecret([string]$Name) {
  & gcloud secrets describe $Name --project $ProjectId 1>$null 2>$null
  return $LASTEXITCODE -eq 0
}

function New-RandomSecretValue {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Ensure-GcloudSecret {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [switch]$Required,
    [switch]$Generate
  )
  if (Test-GcloudSecret $Name) { return $true }
  if ($Required -and -not $Generate) {
    throw "缺少 Secret Manager 密鑰「$Name」。請先建立後再部署。"
  }
  if (-not $Generate) { return $false }
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('shrineflow-secret-' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    [System.IO.File]::WriteAllText($tmp, (New-RandomSecretValue))
    Invoke-Gcloud secrets create $Name --data-file $tmp --project $ProjectId
    Write-Host "已建立 Secret：$Name"
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  return $true
}

Assert-Command 'gcloud'

$R2Endpoint = if ($R2Endpoint) {
  $R2Endpoint.TrimEnd('/')
} else {
  'https://' + $R2AccountId + '.r2.cloudflarestorage.com'
}

$publicMediaBaseUrl = $R2PublicBaseUrl.TrimEnd('/')
if ($publicMediaBaseUrl -notmatch '^https://') {
  throw 'R2PublicBaseUrl 必須是 HTTPS 公開網域，Instagram／Threads 才能抓圖。'
}

if ($AuthMode -eq 'firebase') {
  $missingFirebase = @()
  if (-not $FirebaseApiKey) { $missingFirebase += 'FirebaseApiKey' }
  if (-not $FirebaseAuthDomain) { $missingFirebase += 'FirebaseAuthDomain' }
  if (-not $FirebaseAppId) { $missingFirebase += 'FirebaseAppId' }
  if (-not ($OwnerEmails -or $OwnerUids)) { $missingFirebase += 'OwnerEmails 或 OwnerUids' }
  if ($missingFirebase.Count -gt 0) {
    throw 'Firebase 登入部署缺少參數：' + ($missingFirebase -join ', ') + '。'
  }
}

Invoke-Gcloud config set project $ProjectId
Invoke-Gcloud services enable run.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com identitytoolkit.googleapis.com secretmanager.googleapis.com

$databaseExists = $true
& gcloud firestore databases describe --database="$FirestoreDatabaseId" --project $ProjectId 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  $databaseExists = $false
}
if (-not $databaseExists) {
  Invoke-Gcloud firestore databases create --location $Region --type firestore-native --database="$FirestoreDatabaseId" --project $ProjectId
  Write-Host "已建立 Firestore Native database：$FirestoreDatabaseId"
}

$projectNumber = (& gcloud projects describe $ProjectId --format 'value(projectNumber)').Trim()
if (-not $projectNumber) { throw '無法讀取 GCP project number。' }
$runtimeSa = $projectNumber + '-compute@developer.gserviceaccount.com'
Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member ('serviceAccount:' + $runtimeSa) --role roles/datastore.user --quiet
Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member ('serviceAccount:' + $runtimeSa) --role roles/firebaseauth.admin --quiet

Ensure-GcloudSecret -Name 'shrineflow-scheduler-token' -Generate | Out-Null
Ensure-GcloudSecret -Name 'shrineflow-master-key' -Generate | Out-Null
Ensure-GcloudSecret -Name 'shrineflow-reauth-secret' -Generate | Out-Null
Ensure-GcloudSecret -Name 'shrineflow-r2-access-key' -Required | Out-Null
Ensure-GcloudSecret -Name 'shrineflow-r2-secret-key' -Required | Out-Null
$geminiSecretReady = Ensure-GcloudSecret -Name 'shrineflow-gemini-key'
if ($AuthMode -eq 'legacy') {
  Ensure-GcloudSecret -Name 'shrineflow-operator-password' -Required | Out-Null
  Ensure-GcloudSecret -Name 'shrineflow-session-secret' -Generate | Out-Null
}
if ($EnableMetaWebhook) {
  Ensure-GcloudSecret -Name 'shrineflow-meta-app-secret' -Required | Out-Null
  Ensure-GcloudSecret -Name 'shrineflow-meta-webhook-verify-token' -Required | Out-Null
}

$envVars = [ordered]@{
  NODE_ENV = 'production'
  PORT = '8080'
  SHRINEFLOW_AUTH_MODE = $AuthMode
  SHRINEFLOW_STORAGE_BACKEND = 'firestore'
  SHRINEFLOW_MEDIA_BACKEND = 'r2'
  SHRINEFLOW_SCHEDULER_MODE = 'cloud'
  SHRINEFLOW_SCHEDULER_ALLOW_PLATFORM_AUTH = 'false'
  SHRINEFLOW_CHECK_REVOKED_SESSIONS = 'true'
  SHRINEFLOW_REQUIRE_REAUTH = 'true'
  FIRESTORE_PROJECT_ID = $ProjectId
  FIRESTORE_DATABASE_ID = $FirestoreDatabaseId
  R2_ACCOUNT_ID = $R2AccountId
  R2_BUCKET = $R2Bucket
  R2_ENDPOINT = $R2Endpoint
  R2_PUBLIC_BASE_URL = $publicMediaBaseUrl
  PUBLIC_MEDIA_BASE_URL = $publicMediaBaseUrl
  R2_REGION = 'auto'
  R2_UPLOAD_TTL_SECONDS = '900'
  GEMINI_MODEL = $GeminiModel
  GEMINI_FALLBACK_MODELS = $GeminiFallbackModels
  META_GRAPH_VERSION = 'v25.0'
  THREADS_GRAPH_VERSION = 'v1.0'
}

if ($AuthMode -eq 'firebase') {
  $envVars.FIREBASE_API_KEY = $FirebaseApiKey
  $envVars.FIREBASE_AUTH_DOMAIN = $FirebaseAuthDomain
  $envVars.FIREBASE_PROJECT_ID = $ProjectId
  $envVars.FIREBASE_APP_ID = $FirebaseAppId
  $envVars.SHRINEFLOW_OWNER_EMAILS = $OwnerEmails
  $envVars.SHRINEFLOW_OWNER_UIDS = $OwnerUids
}

function ConvertTo-YamlScalar([object]$Value) {
  $text = [string]$Value
  return "'" + $text.Replace("'", "''") + "'"
}

$envFile = Join-Path ([System.IO.Path]::GetTempPath()) ('shrineflow-cloud-env-' + [guid]::NewGuid().ToString('N') + '.yaml')
$envLines = foreach ($entry in $envVars.GetEnumerator()) {
  $entry.Key + ': ' + (ConvertTo-YamlScalar $entry.Value)
}
Set-Content -LiteralPath $envFile -Value ($envLines -join [Environment]::NewLine) -Encoding utf8

$secretBindings = @(
  'SHRINEFLOW_SCHEDULER_TOKEN=shrineflow-scheduler-token:latest',
  'SHRINEFLOW_MASTER_KEY=shrineflow-master-key:latest',
  'SHRINEFLOW_REAUTH_SECRET=shrineflow-reauth-secret:latest',
  'R2_ACCESS_KEY_ID=shrineflow-r2-access-key:latest',
  'R2_SECRET_ACCESS_KEY=shrineflow-r2-secret-key:latest'
)
if ($geminiSecretReady) {
  $secretBindings += 'GEMINI_API_KEY=shrineflow-gemini-key:latest'
}
if ($AuthMode -eq 'legacy') {
  $secretBindings += @(
    'SHRINEFLOW_OPERATOR_PASSWORD=shrineflow-operator-password:latest',
    'SHRINEFLOW_SESSION_SECRET=shrineflow-session-secret:latest'
  )
}
if ($EnableMetaWebhook) {
  $secretBindings += @(
    'META_APP_SECRET=shrineflow-meta-app-secret:latest',
    'META_WEBHOOK_VERIFY_TOKEN=shrineflow-meta-webhook-verify-token:latest'
  )
}

$source = if ($Image) {
  @('gcloud', 'run', 'deploy', $ServiceName, '--image', $Image)
} else {
  @('gcloud', 'run', 'deploy', $ServiceName, '--source', '.')
}
$source += @(
  '--project', $ProjectId,
  '--region', $Region,
  '--allow-unauthenticated',
  '--port', '8080',
  '--timeout', '540',
  '--memory', '512Mi',
  '--cpu', '1',
  '--min-instances', '0',
  '--max-instances', '1',
  '--env-vars-file', $envFile,
  '--set-secrets', ($secretBindings -join ',')
)

try {
  & $source[0] $source[1..($source.Count - 1)]
  if ($LASTEXITCODE -ne 0) { throw "Cloud Run deployment failed with exit code $LASTEXITCODE." }
} finally {
  Remove-Item -LiteralPath $envFile -Force -ErrorAction SilentlyContinue
}

$serviceUrl = (& gcloud run services describe $ServiceName --project $ProjectId --region $Region --format 'value(status.url)').Trim()
if (-not $serviceUrl) { throw 'Cloud Run 部署後讀不到服務網址。' }

if (-not $SkipScheduler) {
  $schedulerToken = (& gcloud secrets versions access latest --secret shrineflow-scheduler-token --project $ProjectId).Trim()
  $schedulerScript = Join-Path $PSScriptRoot 'cloud-scheduler.ps1'
  & $schedulerScript -ProjectId $ProjectId -ServiceUrl $serviceUrl -SchedulerRegion $Region -SchedulerToken $schedulerToken
}

Write-Host ''
Write-Host 'Cloud Run 已就緒。後台請直接開這個網址（不要走 Firebase Hosting rewrite）：'
Write-Host $serviceUrl
Write-Host ''
Write-Host '下一步：登入後台 → 填 Gemini Key 與品牌平台 Token → 開啟 /api/system/readiness 確認不是 blocked。'
if (-not $geminiSecretReady) {
  Write-Host '尚未綁定 GEMINI_API_KEY Secret；可在後台設定頁填入，會寫進 Firestore 並跨重啟保留。'
}
Write-Host '免費層重點：min-instances=0、max-instances=1、Scheduler 固定 3 個 job。'
