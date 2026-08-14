param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [string]$Region = 'asia-east1',
  [string]$ServiceName = 'shrineflow-api',
  [string]$Image = '',
  [string]$FirebaseProject = ''
)

$ErrorActionPreference = 'Stop'
gcloud config set project $ProjectId
gcloud services enable run.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com

$source = if ($Image) { @('gcloud', 'run', 'deploy', $ServiceName, '--image', $Image) } else { @('gcloud', 'run', 'deploy', $ServiceName, '--source', '.') }
$source += @(
  '--region', $Region,
  '--allow-unauthenticated',
  '--port', '8080',
  '--timeout', '540',
  '--memory', '512Mi',
  '--max-instances', '2',
  '--set-env-vars', 'NODE_ENV=production,PORT=8080,SHRINEFLOW_STORAGE_BACKEND=firestore,SHRINEFLOW_MEDIA_BACKEND=r2,SHRINEFLOW_SCHEDULER_MODE=cloud,SHRINEFLOW_SCHEDULER_ALLOW_PLATFORM_AUTH=false,FIRESTORE_PROJECT_ID=' + $ProjectId,
  '--set-secrets', 'SHRINEFLOW_SCHEDULER_TOKEN=shrineflow-scheduler-token:latest,SHRINEFLOW_OPERATOR_PASSWORD=shrineflow-operator-password:latest,SHRINEFLOW_SESSION_SECRET=shrineflow-session-secret:latest,SHRINEFLOW_MASTER_KEY=shrineflow-master-key:latest,R2_ACCESS_KEY_ID=shrineflow-r2-access-key:latest,R2_SECRET_ACCESS_KEY=shrineflow-r2-secret-key:latest,GEMINI_API_KEY=shrineflow-gemini-key:latest'
)
& $source[0] $source[1..($source.Count - 1)]

if ($FirebaseProject) {
  firebase use $FirebaseProject
  firebase deploy --only hosting
}

Write-Host 'Cloud Run deployment completed. Run deploy/cloud-scheduler.ps1 next.'
