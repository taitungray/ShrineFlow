param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [string]$Region = 'asia-east1',
  [string]$ServiceName = 'shrineflow-api',
  [string]$Image = '',
  [string]$FirebaseProject = '',
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
  [switch]$EnableMetaWebhook
)

$ErrorActionPreference = 'Stop'

function Assert-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "找不到必要指令：$name。請先安裝並登入對應 CLI。"
  }
}

Assert-Command 'gcloud'

$R2Endpoint = if ($R2Endpoint) {
  $R2Endpoint.TrimEnd('/')
} else {
  'https://' + $R2AccountId + '.r2.cloudflarestorage.com'
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

gcloud config set project $ProjectId
if ($LASTEXITCODE -ne 0) { throw '無法切換 gcloud project。' }
gcloud services enable run.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com identitytoolkit.googleapis.com
if ($LASTEXITCODE -ne 0) { throw '無法啟用 Cloud Run／Firestore／Scheduler 所需 API。' }

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
  R2_PUBLIC_BASE_URL = $R2PublicBaseUrl.TrimEnd('/')
  PUBLIC_MEDIA_BASE_URL = $R2PublicBaseUrl.TrimEnd('/')
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
  'R2_ACCESS_KEY_ID=shrineflow-r2-access-key:latest',
  'R2_SECRET_ACCESS_KEY=shrineflow-r2-secret-key:latest',
  'GEMINI_API_KEY=shrineflow-gemini-key:latest'
)
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
  '--region', $Region,
  '--allow-unauthenticated',
  '--port', '8080',
  '--timeout', '540',
  '--memory', '512Mi',
  '--max-instances', '2',
  '--env-vars-file', $envFile,
  '--set-secrets', ($secretBindings -join ',')
)

try {
  & $source[0] $source[1..($source.Count - 1)]
  if ($LASTEXITCODE -ne 0) { throw "Cloud Run deployment failed with exit code $LASTEXITCODE." }
} finally {
  Remove-Item -LiteralPath $envFile -Force -ErrorAction SilentlyContinue
}

if ($FirebaseProject) {
  Assert-Command 'firebase'
  firebase use $FirebaseProject
  if ($LASTEXITCODE -ne 0) { throw '無法切換 Firebase project。' }
  firebase deploy --only hosting
  if ($LASTEXITCODE -ne 0) { throw 'Firebase Hosting deployment failed.' }
}

Write-Host 'Cloud Run deployment completed.'
Write-Host 'Run deploy/cloud-scheduler.ps1 next, then verify /api/healthz and /api/system/readiness.'
