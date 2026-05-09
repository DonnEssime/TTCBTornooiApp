#Requires -RunAsAdministrator
<#
  Workaround when WSL localhost forwarding is broken: forward Windows 127.0.0.1:5173
  to the current WSL distro IP:5173 (where Vite listens).

  Re-run after `wsl --shutdown` or when WSL changes IP.
#>
$raw = (wsl -e hostname -I).Trim()
if (-not $raw) { Write-Error 'Could not read WSL IP (hostname -I).'; exit 1 }
$wslIp = ($raw -split '\s+')[0]
Write-Host "WSL IP: $wslIp"

netsh interface portproxy delete v4tov4 listenport=5173 listenaddress=127.0.0.1 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=5173 connectaddress=$wslIp connectport=5173
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Added portproxy: 127.0.0.1:5173 -> ${wslIp}:5173"
Write-Host "Try: http://127.0.0.1:5173/ in Edge/Chrome on Windows."
Write-Host "List rules: netsh interface portproxy show all"
