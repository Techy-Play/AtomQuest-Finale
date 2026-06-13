# ConnectDesk - Open required network ports for LAN testing
# Run this script as Administrator once.
# Without these firewall rules, mobile devices on the same WiFi cannot reach
# the SFU server (port 3001) or receive WebRTC media (UDP 10000-10100).

$rules = @(
  @{ Name="ConnectDesk-SFU-3001-TCP-in";  Dir="in";  Proto="TCP"; Port="3001";       Desc="ConnectDesk Socket.IO (inbound)"  },
  @{ Name="ConnectDesk-SFU-3001-TCP-out"; Dir="out"; Proto="TCP"; Port="3001";       Desc="ConnectDesk Socket.IO (outbound)" },
  @{ Name="ConnectDesk-RTC-UDP-in";       Dir="in";  Proto="UDP"; Port="10000-10100"; Desc="ConnectDesk WebRTC media (inbound)"  },
  @{ Name="ConnectDesk-RTC-UDP-out";      Dir="out"; Proto="UDP"; Port="10000-10100"; Desc="ConnectDesk WebRTC media (outbound)" }
)

$added = 0
foreach ($r in $rules) {
  $exists = netsh advfirewall firewall show rule name=$r.Name 2>$null | Select-String "Rule Name"
  if ($exists) {
    Write-Host "  SKIP (already exists): $($r.Name)"
  } else {
    netsh advfirewall firewall add rule `
      name=$r.Name dir=$r.Dir action=allow protocol=$r.Proto `
      localport=$r.Port profile=private,domain `
      description=$r.Desc | Out-Null
    Write-Host "  ADDED: $($r.Name)"
    $added++
  }
}

Write-Host ""
Write-Host "Done. $added rule(s) added."
Write-Host ""
Write-Host "Your LAN IP (mobile should use this):"
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" } | Sort-Object PrefixLength -Descending | Select-Object -First 1).IPAddress
Write-Host "  http://${ip}:3000  (Next.js app)"
Write-Host "  http://${ip}:3001  (SFU server - socket.io)"
Write-Host ""
Write-Host "Ports now open for LAN connections."
