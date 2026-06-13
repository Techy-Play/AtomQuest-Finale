# ConnectDesk - Fix firewall for ALL network profiles (including Public WiFi)
# Run this script as Administrator.
#
# Your WiFi is currently classified as "Public" by Windows, which blocked
# the previous private-only rules. This script opens the required ports
# for ALL profiles so mobile devices on the same WiFi can connect.

Write-Host "=== ConnectDesk Firewall Setup ===" -ForegroundColor Cyan
Write-Host ""

# Remove old private-only rules if they exist
$old = @(
  "ConnectDesk-SFU-3001-TCP-in","ConnectDesk-SFU-3001-TCP-out",
  "ConnectDesk-SFU-3001-in","ConnectDesk-SFU-3001-out",
  "ConnectDesk-RTC-UDP-in","ConnectDesk-RTC-UDP-out",
  "ConnectDesk-Node-in","ConnectDesk-Node-out"
)
foreach ($r in $old) { netsh advfirewall firewall delete rule name=$r 2>$null | Out-Null }
Write-Host "Cleaned up old rules." -ForegroundColor Yellow

# Port rules - profile=any covers Public + Private + Domain
$portRules = @(
  @{ Name="ConnectDesk-SFU-3001-TCP-in";  Dir="in";  Proto="TCP"; Port="3001";        Desc="ConnectDesk Socket.IO inbound"  },
  @{ Name="ConnectDesk-SFU-3001-TCP-out"; Dir="out"; Proto="TCP"; Port="3001";        Desc="ConnectDesk Socket.IO outbound" },
  @{ Name="ConnectDesk-RTC-UDP-in";       Dir="in";  Proto="UDP"; Port="10000-10100"; Desc="ConnectDesk WebRTC UDP inbound"  },
  @{ Name="ConnectDesk-RTC-UDP-out";      Dir="out"; Proto="UDP"; Port="10000-10100"; Desc="ConnectDesk WebRTC UDP outbound" }
)

foreach ($r in $portRules) {
  netsh advfirewall firewall add rule `
    name=$r.Name dir=$r.Dir action=allow `
    protocol=$r.Proto localport=$r.Port `
    profile=any description=$r.Desc | Out-Null
  Write-Host "  ADDED port rule: $($r.Name)" -ForegroundColor Green
}

# Allow Node.js executable itself (belt and suspenders)
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodePath) {
  netsh advfirewall firewall add rule name="ConnectDesk-Node-in"  dir=in  action=allow program=$nodePath profile=any description="ConnectDesk Node.js" | Out-Null
  netsh advfirewall firewall add rule name="ConnectDesk-Node-out" dir=out action=allow program=$nodePath profile=any description="ConnectDesk Node.js" | Out-Null
  Write-Host "  ADDED node.exe rule: $nodePath" -ForegroundColor Green
} else {
  Write-Host "  WARN: node.exe not found in PATH - port rules above should still work" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Your Network Info ===" -ForegroundColor Cyan
$profiles = Get-NetConnectionProfile
foreach ($p in $profiles) {
  Write-Host "  $($p.InterfaceAlias): $($p.NetworkCategory)" -ForegroundColor $(if ($p.NetworkCategory -eq "Public") { "Yellow" } else { "Green" })
}

Write-Host ""
Write-Host "=== LAN URLs for mobile ===" -ForegroundColor Cyan
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" }
foreach ($ip in $ips) {
  Write-Host "  http://$($ip.IPAddress):3000   (app)" -ForegroundColor White
  Write-Host "  http://$($ip.IPAddress):3001   (SFU)" -ForegroundColor White
}

Write-Host ""
Write-Host "Done! Now restart the dev server and try again." -ForegroundColor Green
Write-Host "  npm run dev:all" -ForegroundColor Cyan
