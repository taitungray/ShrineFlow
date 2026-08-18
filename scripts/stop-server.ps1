# Stop ShrineFlow HTTP server leftovers (orphan node --watch / npm run dev / :3000).
$ErrorActionPreference = 'SilentlyContinue'

function Test-LocalPortUp {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1', 3000, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(800)) {
      return $false
    }
    return [bool]$client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'localhost:3000' -or
      $_.CommandLine -match '127\.0\.0\.1:3000'
    )
  } |
  ForEach-Object {
    Write-Host "kill opener PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }

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
    & taskkill.exe /PID $_.ProcessId /T /F | Out-Null
  }

Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object {
    Write-Host "kill listener PID $($_.OwningProcess)"
    & taskkill.exe /PID $_.OwningProcess /T /F | Out-Null
  }

Start-Sleep -Milliseconds 400

if (Test-LocalPortUp) {
  Write-Host 'WARN: http://127.0.0.1:3000 still responding'
  exit 1
}

Write-Host 'OK: http://127.0.0.1:3000 is down'
exit 0
