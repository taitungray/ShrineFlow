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
  @{ Name = 'publish-due-targets'; Schedule = '* * * * *'; Path = '/api/internal/scheduler/publish-due' },
  @{ Name = 'export-firestore-backup'; Schedule = '0 3 * * *'; Path = '/api/internal/scheduler/export-backup' },
  @{ Name = 'cleanup-orphan-media'; Schedule = '30 3 * * *'; Path = '/api/internal/scheduler/cleanup-media' }
)

foreach ($job in $jobs) {
  $jobName = $JobPrefix + '-' + $job.Name
  $uri = $ServiceUrl.TrimEnd('/') + $job.Path
  $schedulerOptions = @(
    "--location=$SchedulerRegion",
    "--schedule=$($job.Schedule)",
    "--uri=$uri",
    '--http-method=POST',
    "--headers=X-ShrineFlow-Scheduler-Token=$SchedulerToken",
    '--time-zone=Asia/Taipei',
    '--attempt-deadline=540s',
    '--quiet'
  )
  & gcloud scheduler jobs describe $jobName --location=$SchedulerRegion 2>$null | Out-Null
  $exists = $LASTEXITCODE -eq 0
  if ($exists) {
    & gcloud scheduler jobs update http $jobName @schedulerOptions
  } else {
    & gcloud scheduler jobs create http $jobName @schedulerOptions
  }
  if ($LASTEXITCODE -ne 0) { throw "Scheduler job $jobName failed with exit code $LASTEXITCODE." }
}

Write-Host 'Cloud Scheduler jobs created or updated by name.'
