param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [Parameter(Mandatory = $true)] [string]$ServiceUrl,
  [string]$Region = 'asia-east1',
  [string]$SchedulerRegion = 'asia-east1',
  [string]$JobPrefix = 'shrineflow',
  [string]$SchedulerToken = ''
)

$ErrorActionPreference = 'Stop'
if (-not $SchedulerToken) {
  $SchedulerToken = Read-Host 'Scheduler token used by ShrineFlow'
}
gcloud config set project $ProjectId

$jobs = @(
  @{ Name = 'publish-due-targets'; Schedule = '*/5 * * * *'; Path = '/api/internal/scheduler/publish-due' },
  @{ Name = 'export-firestore-backup'; Schedule = '0 3 * * *'; Path = '/api/internal/scheduler/export-backup' },
  @{ Name = 'cleanup-orphan-media'; Schedule = '30 3 * * *'; Path = '/api/internal/scheduler/cleanup-media' }
)

foreach ($job in $jobs) {
  $jobName = $JobPrefix + '-' + $job.Name
  $uri = $ServiceUrl.TrimEnd('/') + $job.Path
  gcloud scheduler jobs create http $jobName `
    --location=$SchedulerRegion `
    --schedule=$($job.Schedule) `
    --uri=$uri `
    --http-method=POST `
    --headers=X-ShrineFlow-Scheduler-Token=$SchedulerToken `
    --time-zone='Asia/Taipei' `
    --attempt-deadline='540s' `
    --quiet
}

Write-Host 'Cloud Scheduler jobs created or updated by name. If a job already exists, delete it first or use gcloud scheduler jobs update http.'
