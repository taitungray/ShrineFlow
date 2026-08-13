# Stop ShrineFlow HTTP server leftovers (orphan node --watch / npm run dev / :3000).
$ErrorActionPreference = 'SilentlyContinue'

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {
    $_.ExecutablePath -like '*\nodejs\node.exe' -and
    $_.CommandLine -and (
      $_.CommandLine -match '--watch\s+server\.js' -or
      ($_.CommandLine -match 'npm-cli\.js' -and $_.CommandLine -match 'run dev')
    )
  } |
  ForEach-Object {
    Write-Host "kill PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }

Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object {
    Write-Host "kill listener PID $($_.OwningProcess)"
    Stop-Process -Id $_.OwningProcess -Force
  }

Start-Sleep -Milliseconds 400

try {
  Invoke-WebRequest -UseBasicParsing http://localhost:3000 -TimeoutSec 2 | Out-Null
  Write-Host 'WARN: http://localhost:3000 still responding'
  exit 1
} catch {
  Write-Host 'OK: http://localhost:3000 is down'
  exit 0
}
