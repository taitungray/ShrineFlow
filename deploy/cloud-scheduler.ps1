param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [Parameter(Mandatory = $true)] [string]$ServiceUrl,
  [string]$Region = 'asia-east1',
  [string]$SchedulerRegion = 'asia-east1',
  [string]$JobPrefix = 'shrineflow',
  [string]$SchedulerToken = ''
)

$ErrorActionPreference = 'Stop'
$Gcloud = (Get-Command gcloud.cmd -ErrorAction SilentlyContinue).Source
if (-not $Gcloud) { $Gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source }
if (-not $Gcloud) { throw 'gcloud CLI not found.' }
if (-not $SchedulerToken) {
  $SchedulerToken = Read-Host 'Scheduler token used by ShrineFlow'
}
& $Gcloud config set project $ProjectId

$jobs = @(
  @{ Name = 'publish-due-targets'; Schedule = '* * * * *'; Path = '/api/internal/scheduler/publish-due' },
  @{ Name = 'export-firestore-backup'; Schedule = '0 3 * * *'; Path = '/api/internal/scheduler/export-backup' },
  @{ Name = 'cleanup-orphan-media'; Schedule = '30 3 * * *'; Path = '/api/internal/scheduler/cleanup-media' }
)

foreach ($job in $jobs) {
  $jobName = $JobPrefix + '-' + $job.Name
  $uri = $ServiceUrl.TrimEnd('/') + $job.Path
  $commonOptions = @(
    "--location=$SchedulerRegion",
    "--schedule=$($job.Schedule)",
    "--uri=$uri",
    '--http-method=POST',
    '--time-zone=Asia/Taipei',
    '--attempt-deadline=540s',
    '--quiet'
  )
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Gcloud scheduler jobs describe $jobName --location=$SchedulerRegion 1>$null 2>$null
    $exists = ($LASTEXITCODE -eq 0)
  } catch {
    $exists = $false
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($exists) {
    & $Gcloud scheduler jobs update http $jobName @commonOptions "--update-headers=X-ShrineFlow-Scheduler-Token=$SchedulerToken"
  } else {
    & $Gcloud scheduler jobs create http $jobName @commonOptions "--headers=X-ShrineFlow-Scheduler-Token=$SchedulerToken"
  }
  if ($LASTEXITCODE -ne 0) { throw "Scheduler job $jobName failed with exit code $LASTEXITCODE." }
}

Write-Host 'Cloud Scheduler jobs created or updated by name.'
