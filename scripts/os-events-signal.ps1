param(
  [ValidateSet(
    'probe',
    'volume-mute',
    'foreground',
    'brightness-toggle',
    'brightness-get',
    'brightness-set',
    'wifi-disconnect',
    'wifi-reconnect'
  )]
  [string]$Action = 'probe',
  [int]$Level = 0,
  [string]$Profile = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace OttoNative -Name Keyboard -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@
Add-Type -Namespace OttoNative -Name Window -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
'@

function Send-Key([byte]$VirtualKey) {
  [OttoNative.Keyboard]::keybd_event($VirtualKey, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
  [OttoNative.Keyboard]::keybd_event($VirtualKey, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
}

function Get-ForegroundProcess {
  $handle = [OttoNative.Window]::GetForegroundWindow()
  $processId = [uint32]0
  [void][OttoNative.Window]::GetWindowThreadProcessId($handle, [ref]$processId)
  if ($processId -eq 0) { return $null }
  return (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
}

function Get-WifiState {
  $output = @(netsh wlan show interfaces 2>$null)
  $supported = [bool]($output -match '^\s+Name\s+:')
  $connected = [bool]($output -match '^\s+State\s+:\s+connected')
  $ssid = ($output | Select-String -Pattern '^\s+SSID\s+:\s+(.+)$' | Select-Object -First 1)
  $profile = ($output | Select-String -Pattern '^\s+Profile\s+:\s+(.+)$' | Select-Object -First 1)
  $state = @{ supported = $supported; connected = $connected }
  if ($ssid) { $state.ssid = $ssid.Matches[0].Groups[1].Value.Trim() }
  if ($profile) { $state.profile = $profile.Matches[0].Groups[1].Value.Trim() }
  return $state
}

function Get-Brightness {
  $monitor = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $monitor) { return $null }
  return [int]$monitor.CurrentBrightness
}

function Set-Brightness([int]$Value) {
  $method = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $method) { return $false }
  $clamped = [Math]::Max(0, [Math]::Min(100, $Value))
  Invoke-CimMethod -InputObject $method -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = $clamped } | Out-Null
  return $true
}

switch ($Action) {
  'volume-mute' {
    Send-Key 0xAD
    [pscustomobject]@{ action = 'volume-mute'; sent = $true } | ConvertTo-Json -Compress
  }
  'foreground' {
    [pscustomobject]@{ process = Get-ForegroundProcess } | ConvertTo-Json -Compress
  }
  'brightness-toggle' {
    $previous = Get-Brightness
    if ($null -eq $previous) {
      [pscustomobject]@{ supported = $false } | ConvertTo-Json -Compress
      break
    }
    $target = if ($previous -ge 50) { $previous - 10 } else { $previous + 10 }
    $applied = Set-Brightness $target
    [pscustomobject]@{
      supported = $true
      previous = $previous
      applied = if ($applied) { [Math]::Max(0, [Math]::Min(100, $target)) } else { $null }
    } | ConvertTo-Json -Compress
  }
  'brightness-get' {
    $level = Get-Brightness
    [pscustomobject]@{ supported = ($null -ne $level); level = $level } | ConvertTo-Json -Compress
  }
  'brightness-set' {
    [pscustomobject]@{ supported = (Set-Brightness $Level); level = $Level } | ConvertTo-Json -Compress
  }
  'wifi-disconnect' {
    $wifi = Get-WifiState
    if (-not $wifi.connected) {
      [pscustomobject]@{ disconnected = $false; reason = 'not connected'; profile = $wifi.profile } |
        ConvertTo-Json -Compress
      break
    }
    $before = netsh wlan disconnect | Out-String
    Start-Sleep -Seconds 1
    [pscustomobject]@{
      disconnected = (Get-WifiState).connected -eq $false
      profile = $wifi.profile
      output = $before.Trim()
    } | ConvertTo-Json -Compress
  }
  'wifi-reconnect' {
    $target = if ($Profile) { $Profile } else { (Get-WifiState).profile }
    if (-not $target) {
      [pscustomobject]@{ connected = $false; reason = 'no profile' } | ConvertTo-Json -Compress
      break
    }
    netsh wlan connect name="$target" | Out-Null
    Start-Sleep -Seconds 3
    $wifi = Get-WifiState
    [pscustomobject]@{ connected = $wifi.connected; profile = $target } | ConvertTo-Json -Compress
  }
  default {
    $battery = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue)
    $audio = @(Get-CimInstance -ClassName Win32_SoundDevice -ErrorAction SilentlyContinue |
      Where-Object { $_.Status -eq 'OK' })
    $bluetooth = @(Get-PnpDevice -Class Bluetooth -Status OK -ErrorAction SilentlyContinue)
    [pscustomobject]@{
      audio = $audio.Count -gt 0
      audioDevices = $audio.Count
      battery = $battery.Count -gt 0
      batteryPercent = if ($battery.Count -gt 0) { $battery[0].EstimatedChargeRemaining } else { $null }
      brightness = $null -ne (Get-Brightness)
      wifi = Get-WifiState
      bluetoothPaired = $bluetooth.Count
      foreground = Get-ForegroundProcess
    } | ConvertTo-Json -Compress -Depth 4
  }
}
