param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [string]$Region = 'asia-east1',
  [string]$ServiceName = 'shrineflow-api',
  [string]$Image = '',
  [ValidateSet('firebase', 'legacy')] [string]$AuthMode = 'firebase',
  [string]$R2AccountId = '',
  [string]$R2Bucket = 'shrineflow-media',
  [string]$R2PublicBaseUrl = '',
  [string]$R2Endpoint = '',
  [string]$FirestoreDatabaseId = '(default)',
  [string]$GeminiModel = 'gemini-3.6-flash',
  [string]$GeminiFallbackModels = 'gemini-2.5-flash',
  [string]$FirebaseApiKey = '',
  [string]$FirebaseAuthDomain = '',
  [string]$FirebaseAppId = '',
  [string]$FirebaseProjectId = '',
  [string]$OwnerEmails = '',
  [string]$OwnerUids = '',
  [switch]$EnableMetaWebhook,
  [switch]$Bootstrap,
  [switch]$UpdateConfig,
  [switch]$UpdateScheduler,
  [switch]$SkipScheduler
)

$ErrorActionPreference = 'Stop'

function Get-GcloudCommand {
  $cmd = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'gcloud CLI not found. Install Google Cloud SDK and open a new PowerShell window.'
}

$Gcloud = Get-GcloudCommand

function Invoke-Gcloud {
  & $Gcloud @args
  if ($LASTEXITCODE -ne 0) {
    throw ('gcloud failed: ' + ($args -join ' '))
  }
}

function Invoke-GcloudRetry {
  $max = 6
  for ($attempt = 1; $attempt -le $max; $attempt++) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $code = 1
    try {
      & $Gcloud @args
      $code = $LASTEXITCODE
    } catch {
      $code = 1
    } finally {
      $ErrorActionPreference = $previous
    }
    if ($code -eq 0) { return }
    if ($attempt -eq $max) {
      throw ('gcloud failed: ' + ($args -join ' '))
    }
    $delay = [Math]::Min(20, 2 * $attempt)
    Write-Host "Retrying gcloud in ${delay}s (attempt $attempt/$max)..."
    Start-Sleep -Seconds $delay
  }
}

function Test-GcloudSuccess {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Gcloud @args 1>$null 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Test-GcloudSecret([string]$Name) {
  return Test-GcloudSuccess secrets describe $Name --project $ProjectId
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
    throw "Missing Secret Manager secret '$Name'. Create it before deploying."
  }
  if (-not $Generate) { return $false }
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('shrineflow-secret-' + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    [System.IO.File]::WriteAllText($tmp, (New-RandomSecretValue))
    Invoke-Gcloud secrets create $Name --data-file $tmp --project $ProjectId
    Write-Host "Created secret: $Name"
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
  return $true
}

function ConvertTo-YamlScalar([object]$Value) {
  $text = [string]$Value
  return "'" + $text.Replace("'", "''") + "'"
}

function Assert-BootstrapInputs {
  if (-not $R2AccountId) { throw 'First-time / -Bootstrap / -UpdateConfig deploy requires -R2AccountId.' }
  if (-not $R2PublicBaseUrl) { throw 'First-time / -Bootstrap / -UpdateConfig deploy requires -R2PublicBaseUrl.' }
  $publicMediaBaseUrl = $R2PublicBaseUrl.TrimEnd('/')
  if ($publicMediaBaseUrl -notmatch '^https://') {
    throw 'R2PublicBaseUrl must be an HTTPS public domain so Instagram/Threads can fetch media.'
  }
  if ($AuthMode -eq 'firebase') {
    $missingFirebase = @()
    if (-not $FirebaseApiKey) { $missingFirebase += 'FirebaseApiKey' }
    if (-not $FirebaseAuthDomain) { $missingFirebase += 'FirebaseAuthDomain' }
    if (-not $FirebaseAppId) { $missingFirebase += 'FirebaseAppId' }
    if (-not ($OwnerEmails -or $OwnerUids)) { $missingFirebase += 'OwnerEmails or OwnerUids' }
    if ($missingFirebase.Count -gt 0) {
      throw ('Firebase deploy is missing: ' + ($missingFirebase -join ', '))
    }
  }
  return $publicMediaBaseUrl
}

function Get-RuntimeEnvFile([string]$PublicMediaBaseUrl) {
  $resolvedEndpoint = if ($R2Endpoint) {
    $R2Endpoint.TrimEnd('/')
  } else {
    'https://' + $R2AccountId + '.r2.cloudflarestorage.com'
  }
  $envVars = [ordered]@{
    NODE_ENV = 'production'
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
    R2_ENDPOINT = $resolvedEndpoint
    R2_PUBLIC_BASE_URL = $PublicMediaBaseUrl
    PUBLIC_MEDIA_BASE_URL = $PublicMediaBaseUrl
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
    $envVars.FIREBASE_PROJECT_ID = $(if ($FirebaseProjectId) { $FirebaseProjectId } else { $ProjectId })
    $envVars.FIREBASE_APP_ID = $FirebaseAppId
    $envVars.SHRINEFLOW_OWNER_EMAILS = $OwnerEmails
    $envVars.SHRINEFLOW_OWNER_UIDS = $OwnerUids
  }
  $envFile = Join-Path ([System.IO.Path]::GetTempPath()) ('shrineflow-cloud-env-' + [guid]::NewGuid().ToString('N') + '.yaml')
  $envLines = foreach ($entry in $envVars.GetEnumerator()) {
    $entry.Key + ': ' + (ConvertTo-YamlScalar $entry.Value)
  }
  Set-Content -LiteralPath $envFile -Value ($envLines -join [Environment]::NewLine) -Encoding ascii
  return $envFile
}

function Get-SecretBindings([bool]$GeminiReady) {
  $secretBindings = @(
    'SHRINEFLOW_SCHEDULER_TOKEN=shrineflow-scheduler-token:latest',
    'SHRINEFLOW_MASTER_KEY=shrineflow-master-key:latest',
    'SHRINEFLOW_REAUTH_SECRET=shrineflow-reauth-secret:latest',
    'R2_ACCESS_KEY_ID=shrineflow-r2-access-key:latest',
    'R2_SECRET_ACCESS_KEY=shrineflow-r2-secret-key:latest'
  )
  if ($GeminiReady) {
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
  return $secretBindings
}

function Ensure-ArtifactRegistry([string]$RepoName) {
  if (Test-GcloudSuccess artifacts repositories describe $RepoName --location $Region --project $ProjectId) {
    return
  }
  Write-Host "Creating Artifact Registry repository: $RepoName"
  Invoke-Gcloud artifacts repositories create $RepoName --repository-format docker --location $Region --project $ProjectId --quiet
}

function Ensure-CloudBuildPushAccess([string]$RepoName) {
  $projectNumber = (& $Gcloud projects describe $ProjectId --format 'value(projectNumber)').Trim()
  if (-not $projectNumber) { throw 'Could not read GCP project number.' }
  $buildSa = $projectNumber + '@cloudbuild.gserviceaccount.com'
  Invoke-GcloudRetry artifacts repositories add-iam-policy-binding $RepoName `
    --location $Region `
    --project $ProjectId `
    --member ('serviceAccount:' + $buildSa) `
    --role roles/artifactregistry.writer `
    --quiet
}

function Build-CachedImage([string]$ImageUri, [string]$CacheUri) {
  $config = Join-Path $PSScriptRoot 'cloudbuild.yaml'
  Write-Host "Building $ImageUri with Kaniko layer cache..."
  Invoke-Gcloud builds submit . `
    --config $config `
    --project $ProjectId `
    --substitutions ("_IMAGE=$ImageUri,_CACHE=$CacheUri")
}

Invoke-Gcloud config set project $ProjectId

$serviceExists = Test-GcloudSuccess run services describe $ServiceName --project $ProjectId --region $Region
$doBootstrap = [bool]$Bootstrap -or -not $serviceExists
$doConfig = $doBootstrap -or [bool]$UpdateConfig
$doScheduler = -not $SkipScheduler -and ($doBootstrap -or [bool]$UpdateScheduler)
$repoName = 'shrineflow'
$imageUri = if ($Image) { $Image } else { $Region + '-docker.pkg.dev/' + $ProjectId + '/' + $repoName + '/api:latest' }
$cacheUri = $Region + '-docker.pkg.dev/' + $ProjectId + '/' + $repoName + '/cache'

if ($doBootstrap) {
  Write-Host 'Bootstrap: APIs, Firestore, IAM, secrets, Artifact Registry.'
} elseif ($doConfig) {
  Write-Host 'Updating Cloud Run env/secrets only; skipping IAM and API enable.'
} else {
  Write-Host 'Incremental deploy: cached image build, keep existing env/secrets/scheduler.'
}

$publicMediaBaseUrl = ''
$geminiSecretReady = $false
if ($doConfig) {
  $publicMediaBaseUrl = Assert-BootstrapInputs
}

if ($doBootstrap) {
  Invoke-Gcloud services enable run.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com identitytoolkit.googleapis.com secretmanager.googleapis.com
  $databaseExists = Test-GcloudSuccess firestore databases describe --database="$FirestoreDatabaseId" --project $ProjectId
  if (-not $databaseExists) {
    Invoke-Gcloud firestore databases create --location $Region --type firestore-native --database="$FirestoreDatabaseId" --project $ProjectId
    Write-Host "Created Firestore Native database: $FirestoreDatabaseId"
  }
  $projectNumber = (& $Gcloud projects describe $ProjectId --format 'value(projectNumber)').Trim()
  if (-not $projectNumber) { throw 'Could not read GCP project number.' }
  $runtimeSa = $projectNumber + '-compute@developer.gserviceaccount.com'
  Invoke-GcloudRetry projects add-iam-policy-binding $ProjectId --member ('serviceAccount:' + $runtimeSa) --role roles/datastore.user --quiet
  Start-Sleep -Seconds 2
  Invoke-GcloudRetry projects add-iam-policy-binding $ProjectId --member ('serviceAccount:' + $runtimeSa) --role roles/firebaseauth.admin --quiet
  Start-Sleep -Seconds 2
  Invoke-GcloudRetry projects add-iam-policy-binding $ProjectId --member ('serviceAccount:' + $runtimeSa) --role roles/secretmanager.secretAccessor --quiet
  $firebaseIamProject = if ($FirebaseProjectId) { $FirebaseProjectId } else { $ProjectId }
  if ($firebaseIamProject -ne $ProjectId) {
    Start-Sleep -Seconds 2
    Invoke-GcloudRetry projects add-iam-policy-binding $firebaseIamProject --member ('serviceAccount:' + $runtimeSa) --role roles/firebaseauth.admin --quiet
  }
  Start-Sleep -Seconds 8
  Ensure-ArtifactRegistry $repoName
  Ensure-CloudBuildPushAccess $repoName
}

if ($doConfig) {
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
} else {
  $geminiSecretReady = Test-GcloudSecret 'shrineflow-gemini-key'
}

if (-not $Image) {
  if (-not $doBootstrap) {
    if (-not (Test-GcloudSuccess artifacts repositories describe $repoName --location $Region --project $ProjectId)) {
      throw "Artifact Registry '$repoName' is missing. Re-run with -Bootstrap once."
    }
  }
  Build-CachedImage $imageUri $cacheUri
  $Image = $imageUri
}

$deployArgs = @(
  'run', 'deploy', $ServiceName,
  '--image', $Image,
  '--project', $ProjectId,
  '--region', $Region,
  '--allow-unauthenticated',
  '--port', '8080',
  '--timeout', '540',
  '--memory', '512Mi',
  '--cpu', '1',
  '--min-instances', '0',
  '--max-instances', '1'
)

$envFile = ''
if ($doConfig) {
  $envFile = Get-RuntimeEnvFile $publicMediaBaseUrl
  $deployArgs += @(
    '--env-vars-file', $envFile,
    '--set-secrets', ((Get-SecretBindings $geminiSecretReady) -join ',')
  )
}

try {
  & $Gcloud @deployArgs
  if ($LASTEXITCODE -ne 0) { throw "Cloud Run deployment failed with exit code $LASTEXITCODE." }
} finally {
  if ($envFile) { Remove-Item -LiteralPath $envFile -Force -ErrorAction SilentlyContinue }
}

$serviceUrl = (& $Gcloud run services describe $ServiceName --project $ProjectId --region $Region --format 'value(status.url)').Trim()
if (-not $serviceUrl) { throw 'Cloud Run deploy finished but the service URL could not be read.' }

if ($doScheduler) {
  $schedulerToken = (& $Gcloud secrets versions access latest --secret shrineflow-scheduler-token --project $ProjectId).Trim()
  $schedulerScript = Join-Path $PSScriptRoot 'cloud-scheduler.ps1'
  & $schedulerScript -ProjectId $ProjectId -ServiceUrl $serviceUrl -SchedulerRegion $Region -SchedulerToken $schedulerToken
}

Write-Host ''
Write-Host 'Cloud Run is ready. Open this URL (do not use Firebase Hosting rewrite):'
Write-Host $serviceUrl
Write-Host ''
if ($doBootstrap) {
  Write-Host 'Next: sign in -> set Gemini key and brand platform tokens -> open /api/system/readiness and confirm it is not blocked.'
} else {
  Write-Host 'Incremental deploy finished. Use -UpdateConfig to rewrite env/secrets, -Bootstrap to redo IAM/APIs, -UpdateScheduler to refresh jobs.'
}
if ($doConfig -and -not $geminiSecretReady) {
  Write-Host 'GEMINI_API_KEY secret is not bound. You can set it in Settings; it is stored in Firestore across restarts.'
}
Write-Host 'Free-tier notes: min-instances=0, max-instances=1, three Scheduler jobs.'
