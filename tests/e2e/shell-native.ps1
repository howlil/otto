param(
  [string]$App = (Join-Path $PSScriptRoot "..\..\src-tauri\target\debug\otto.exe"),
  [ValidateSet("any", "floating", "attached")][string]$ExpectPlacement = "any",
  [switch]$SkipCapture,
  [int]$TargetProcessId = 0,
  [switch]$KeepExpanded
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -Namespace OttoProbe -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
[DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hwnd);
[DllImport("user32.dll")] public static extern int GetClassNameW(IntPtr hwnd, System.Text.StringBuilder name, int count);
[DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);
[DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetWindowLongPtrW(IntPtr hwnd, int index, IntPtr value);
[DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, IntPtr extra);
[DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
[DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
[StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }
[DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
[DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
[DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
[DllImport("gdi32.dll")] public static extern int GetRgnBox(IntPtr region, out RECT rect);
[DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);
public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
public struct POINT { public int X; public int Y; }
'@

[OttoProbe.Native]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null

$EXCLUDE_FROM_CAPTURE = 0x11
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW = 0x00040000
$GWL_EXSTYLE = -20
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$VK_ESCAPE = 0x1B
$CELL = 16

function Get-OttoWindow([int]$processId) {
  $script:found = [IntPtr]::Zero
  $script:foundArea = 0
  $callback = [OttoProbe.Native+EnumProc] {
    param($hwnd, $param)
    $owner = 0
    [OttoProbe.Native]::GetWindowThreadProcessId($hwnd, [ref]$owner) | Out-Null
    if ($owner -ne $processId -or -not [OttoProbe.Native]::IsWindowVisible($hwnd)) { return $true }
    if ([OttoProbe.Native]::GetWindowTextLengthW($hwnd) -ne 0) { return $true }
    $rect = New-Object OttoProbe.Native+RECT
    [OttoProbe.Native]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    $area = ($rect.Right - $rect.Left) * ($rect.Bottom - $rect.Top)
    if ($area -lt 900) { return $true }
    if ($area -gt $script:foundArea) {
      $script:foundArea = $area
      $script:found = $hwnd
    }
    return $true
  }
  [OttoProbe.Native]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return $script:found
}

function Get-StartupDiagnostics([int]$processId, [string]$stdoutPath, [string]$stderrPath) {
  $found = New-Object System.Collections.Generic.List[string]
  $callback = [OttoProbe.Native+EnumProc] {
    param($hwnd, $param)
    $owner = 0
    [OttoProbe.Native]::GetWindowThreadProcessId($hwnd, [ref]$owner) | Out-Null
    if ($owner -ne $processId) { return $true }
    $rect = New-Object OttoProbe.Native+RECT
    [OttoProbe.Native]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
    $className = New-Object System.Text.StringBuilder 128
    [OttoProbe.Native]::GetClassNameW($hwnd, $className, 128) | Out-Null
    $found.Add(("{0}x{1} visible={2} titleLength={3} class={4}" -f
      ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top),
      [OttoProbe.Native]::IsWindowVisible($hwnd),
      [OttoProbe.Native]::GetWindowTextLengthW($hwnd), $className.ToString()))
    return $true
  }
  [OttoProbe.Native]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  $stdout = if (Test-Path $stdoutPath) { (Get-Content -Raw $stdoutPath -ErrorAction SilentlyContinue) } else { "" }
  $stderr = if (Test-Path $stderrPath) { (Get-Content -Raw $stderrPath -ErrorAction SilentlyContinue) } else { "" }
  return ("Windows=[{0}]; stdout={1}; stderr={2}" -f
    ($found -join "; "), "$stdout".Substring(0, [math]::Min(1500, "$stdout".Length)),
    "$stderr".Substring(0, [math]::Min(1500, "$stderr".Length)))
}

function Get-HostRect($hwnd) {
  $rect = New-Object OttoProbe.Native+RECT
  [OttoProbe.Native]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  return $rect
}

function Get-Rect($hwnd) {
  $rect = Get-HostRect $hwnd
  $region = Get-WindowRegionBox $hwnd
  if ($null -ne $region) {
    $rect.Right = $rect.Left + $region.Left + $region.Width
    $rect.Bottom = $rect.Top + $region.Top + $region.Height
    $rect.Left += $region.Left
    $rect.Top += $region.Top
  }
  return $rect
}

function Get-RectSize($rect) {
  return @{ Width = $rect.Right - $rect.Left; Height = $rect.Bottom - $rect.Top }
}

function Move-MouseInput([int]$x, [int]$y) {
  $virtualLeft = [OttoProbe.Native]::GetSystemMetrics(76)
  $virtualTop = [OttoProbe.Native]::GetSystemMetrics(77)
  $virtualWidth = [OttoProbe.Native]::GetSystemMetrics(78)
  $virtualHeight = [OttoProbe.Native]::GetSystemMetrics(79)
  $mouse = New-Object OttoProbe.Native+MOUSEINPUT
  $mouse.dx = [int][math]::Round(($x - $virtualLeft) * 65535 / [math]::Max(1, $virtualWidth - 1))
  $mouse.dy = [int][math]::Round(($y - $virtualTop) * 65535 / [math]::Max(1, $virtualHeight - 1))
  $mouse.dwFlags = 0x0001 -bor 0x8000 -bor 0x4000
  $input = New-Object OttoProbe.Native+INPUT
  $input.type = 0
  $input.mi = $mouse
  $inputs = [OttoProbe.Native+INPUT[]]@($input)
  $sent = [OttoProbe.Native]::SendInput(1, $inputs, [Runtime.InteropServices.Marshal]::SizeOf($inputs[0]))
  if ($sent -ne 1) {
    throw "SendInput failed while moving the pointer to $x,$y"
  }
}

function Click-MouseInput([int]$x, [int]$y, [int]$expectedOwner) {
  Move-MouseInput $x $y
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.Application]::DoEvents()
  $actual = New-Object OttoProbe.Native+POINT
  [OttoProbe.Native]::GetCursorPos([ref]$actual) | Out-Null
  if ($actual.X -ne $x -or $actual.Y -ne $y) {
    throw "Native click cancelled: pointer left the owned target before button input"
  }
  $owner = Get-PointOwnerPid $actual.X $actual.Y
  if ($expectedOwner -le 0 -or $owner -ne $expectedOwner) {
    throw "Native click cancelled at $x,$($y): expected owned PID $expectedOwner, observed PID $owner"
  }
  [OttoProbe.Native]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 60
  [OttoProbe.Native]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
  [System.Windows.Forms.Application]::DoEvents()
}

function Get-WindowStyle($hwnd) {
  return [OttoProbe.Native]::GetWindowLongPtrW($hwnd, $GWL_EXSTYLE).ToInt64()
}

function Get-PointOwnerPid([int]$x, [int]$y) {
  $point = New-Object OttoProbe.Native+POINT
  $point.X = $x
  $point.Y = $y
  $owner = 0
  $target = [OttoProbe.Native]::WindowFromPoint($point)
  if ($target -eq [IntPtr]::Zero) { return 0 }
  $root = [OttoProbe.Native]::GetAncestor($target, 2)
  if ($root -ne [IntPtr]::Zero) { $target = $root }
  [OttoProbe.Native]::GetWindowThreadProcessId($target, [ref]$owner) | Out-Null
  return $owner
}

function Get-WindowRegionBox($hwnd) {
  $probe = [OttoProbe.Native]::CreateRectRgn(0, 0, 0, 0)
  if ($probe -eq [IntPtr]::Zero) { return $null }
  $kind = [OttoProbe.Native]::GetWindowRgn($hwnd, $probe)
  $box = $null
  if ($kind -ne 0) {
    $rect = New-Object OttoProbe.Native+RECT
    if ([OttoProbe.Native]::GetRgnBox($probe, [ref]$rect) -ne 0) {
      $box = @{ Left = $rect.Left; Top = $rect.Top; Width = $rect.Right - $rect.Left; Height = $rect.Bottom - $rect.Top; Kind = $kind }
    }
  }
  [OttoProbe.Native]::DeleteObject($probe) | Out-Null
  return $box
}

function Get-MonitorBounds($hwnd) {
  return [System.Windows.Forms.Screen]::FromHandle($hwnd).Bounds
}

function Test-ToolWindow($style) {
  return (($style -band $WS_EX_TOOLWINDOW) -ne 0) -and (($style -band $WS_EX_APPWINDOW) -eq 0)
}

function New-PatternForm($bounds) {
  $form = New-Object System.Windows.Forms.Form
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.ShowInTaskbar = $false
  $form.TopMost = $true
  $form.Bounds = $bounds
  $form.BackColor = [System.Drawing.Color]::FromArgb(255, 0, 255)
  $form.Show()
  $form.TopMost = $true
  $form.Activate()
  $form.BringToFront()
  for ($frame = 0; $frame -lt 20; $frame++) {
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 25
  }
  return $form
}

function Measure-PatternMatch($region) {
  $size = Get-RectSize $region
  $bitmap = New-Object System.Drawing.Bitmap($size.Width, $size.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($region.Left, $region.Top, 0, 0, $bitmap.Size)
  $graphics.Dispose()
  $matched = 0
  $samples = 0
  for ($x = 2; $x -lt $size.Width - 2; $x += 4) {
    for ($y = 2; $y -lt $size.Height - 2; $y += 4) {
      $pixel = $bitmap.GetPixel($x, $y)
      if ([math]::Abs($pixel.R - 255) -lt 12 -and $pixel.G -lt 16 -and [math]::Abs($pixel.B - 255) -lt 12) {
        $matched++
      }
      $samples++
    }
  }
  $bitmap.Dispose()
  return [math]::Round($matched / [math]::Max(1, $samples), 3)
}

function Sample-Morph($hwnd, [int]$timeoutMs = 2500) {
  $samples = New-Object System.Collections.Generic.List[object]
  $stable = 0
  $lastWidth = -1
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    $rect = Get-Rect $hwnd
    $size = Get-RectSize $rect
    $samples.Add([pscustomobject]@{
      Left = $rect.Left
      Right = $rect.Right
      Width = $size.Width
      Center = ($rect.Left + $rect.Right) / 2
    })
    if ($size.Width -eq $lastWidth) { $stable++ } else { $stable = 0; $lastWidth = $size.Width }
    if ($stable -ge 4) { break }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 20
  }
  return $samples
}

function Wait-Interactive($hwnd, [int]$timeoutMs = 8000) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  $stable = 0
  $previousSize = $null
  while ((Get-Date) -lt $deadline) {
    $size = Get-RectSize (Get-Rect $hwnd)
    $settled = (Test-ToolWindow (Get-WindowStyle $hwnd)) -and
      $null -ne $previousSize -and
      $previousSize.Width -eq $size.Width -and
      $previousSize.Height -eq $size.Height
    if ($settled) { $stable++ } else { $stable = 0 }
    $previousSize = $size
    if ($stable -ge 5) { return $true }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
  }
  return $false
}

function Stop-Otto($process) {
  if ($null -eq $process -or $process.HasExited) { return }
  $marker = Join-Path $env:LOCALAPPDATA "site.howlil.otto\agent-active.marker"
  if (Test-Path $marker) {
    Write-Warning "An Agent run is active; preserving Otto PID $($process.Id) and its test profile"
    return
  }
  $process.CloseMainWindow() | Out-Null
  if (-not $process.WaitForExit(3000)) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    $process.WaitForExit(3000) | Out-Null
  }
}

if (-not (Test-Path $App)) { throw "Build the debug Tauri binary first: $App" }
if (Test-Path (Join-Path $env:LOCALAPPDATA "site.howlil.otto\agent-active.marker")) {
  throw "Resolve the active Agent run before native shell acceptance"
}
$running = @(Get-Process otto -ErrorAction SilentlyContinue)
if ($TargetProcessId -gt 0) {
  if (-not $SkipCapture) { throw "Attaching to a controller-owned process requires -SkipCapture" }
  if ($running.Count -ne 1 -or $running[0].Id -ne $TargetProcessId -or $running[0].Path -ne (Resolve-Path $App).Path) {
    throw "The target must be the single Otto process for the requested executable"
  }
} elseif ($running.Count -gt 0) {
  throw "Close the running Otto instance (PID $($running.Id -join ',')) first normally; the single-instance guard exits a second process."
}

$origin = New-Object OttoProbe.Native+POINT
[OttoProbe.Native]::GetCursorPos([ref]$origin) | Out-Null
$failures = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]
$process = $null
$ownsProcess = $TargetProcessId -eq 0
$profile = $null
$form = $null

try {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  if (-not $SkipCapture) {
    $patternBounds = New-Object System.Drawing.Rectangle(($screen.Left + [int](($screen.Width - 900) / 2)), $screen.Top, 900, 320)
    $form = New-PatternForm $patternBounds
    $backdropRegion = New-Object OttoProbe.Native+RECT
    $backdropRegion.Left = $patternBounds.Left + 8; $backdropRegion.Top = $patternBounds.Top + 8
    $backdropRegion.Right = $backdropRegion.Left + 300; $backdropRegion.Bottom = $backdropRegion.Top + 120
    $backdropReady = Measure-PatternMatch $backdropRegion
    if ($backdropReady -lt 0.9) {
      throw "Pattern backdrop did not render (match $backdropReady); close other top windows or rerun."
    }
  }

  Move-MouseInput ([int]($screen.Right - 4)) ([int]($screen.Bottom - 4))
  Start-Sleep -Milliseconds 200
  $stdoutPath = $null
  $stderrPath = $null
  if ($ownsProcess) {
    $profile = Join-Path ([System.IO.Path]::GetTempPath()) ("otto-shell-probe-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $profile | Out-Null
    $env:WEBVIEW2_USER_DATA_FOLDER = $profile
    $stdoutPath = Join-Path $profile 'otto-startup.stdout.log'
    $stderrPath = Join-Path $profile 'otto-startup.stderr.log'
    $process = Start-Process -FilePath $App -WorkingDirectory (Split-Path -Parent $App) -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  } else {
    $process = Get-Process -Id $TargetProcessId
  }
  $hwnd = [IntPtr]::Zero
  $startup = [Diagnostics.Stopwatch]::StartNew()
  $deadline = (Get-Date).AddSeconds(40)
  while ($hwnd -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
    $process.Refresh()
    if ($process.HasExited) { break }
    $hwnd = Get-OttoWindow $process.Id
  }
  $startup.Stop()
  if ($hwnd -eq [IntPtr]::Zero) {
    $process.Refresh()
    $exitStatus = if ($process.HasExited) { "exited code=$($process.ExitCode)" } else { "still-running" }
    $details = if ($ownsProcess) { Get-StartupDiagnostics $process.Id $stdoutPath $stderrPath } else { "Controller-owned process has no visible Otto window" }
    throw "Otto startup failed after $($startup.ElapsedMilliseconds)ms (PID $($process.Id), $exitStatus). $details"
  }

  [OttoProbe.Native]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) | Out-Null
  $firstStyle = Get-WindowStyle $hwnd
  $interactive = Wait-Interactive $hwnd 8000
  if (-not $interactive) {
    $failures.Add("the window never settled on a stable tool-window geometry")
  }
  Start-Sleep -Milliseconds 300
  $style = Get-WindowStyle $hwnd
  $titleLength = [OttoProbe.Native]::GetWindowTextLengthW($hwnd)
  $affinity = 0
  [OttoProbe.Native]::GetWindowDisplayAffinity($hwnd, [ref]$affinity) | Out-Null

  if ($titleLength -ne 0) { $failures.Add("window title is not blank (length $titleLength)") }
  if (-not (Test-ToolWindow $style)) { $failures.Add(("window is not an untitled tool window (exstyle 0x{0:X})" -f $style)) }
  if ($affinity -ne $EXCLUDE_FROM_CAPTURE) { $failures.Add(("display affinity is 0x{0:X} instead of 0x11" -f $affinity)) }
  if ($ownsProcess -and -not (Test-ToolWindow $firstStyle)) {
    $failures.Add(("first visible frame was a taskbar app window (exstyle 0x{0:X}); overlay styling must run before the window is shown" -f $firstStyle))
  }

  $compact = Get-Rect $hwnd
  $hostSize = Get-RectSize (Get-HostRect $hwnd)
  $compactSize = Get-RectSize $compact

  $matchInside = $null
  $matchOutside = $null
  $captureVerdict = "not-run"
  if (-not $SkipCapture) {
    $ottoRegion = New-Object OttoProbe.Native+RECT
    $ottoRegion.Left = $compact.Left; $ottoRegion.Top = $compact.Top
    $ottoRegion.Right = $compact.Right; $ottoRegion.Bottom = $compact.Bottom
    $matchInside = Measure-PatternMatch $ottoRegion
    $controlRegion = New-Object OttoProbe.Native+RECT
    $controlRegion.Left = $patternBounds.Left + 8; $controlRegion.Top = $patternBounds.Top + 8
    $controlRegion.Right = $controlRegion.Left + $compactSize.Width; $controlRegion.Bottom = $controlRegion.Top + $compactSize.Height
    $matchOutside = Measure-PatternMatch $controlRegion
    $form.Close()
    $form.Dispose()
    $form = $null
    $captureVerdict = "inconclusive"
    if ($matchOutside -lt 0.6) {
      $notes.Add("backdrop pattern was not visible outside Otto (match $matchOutside); capture verdict is not usable")
    } elseif ($matchInside -ge 0.8) {
      $captureVerdict = "excluded"
    } elseif ($matchInside -le 0.3) {
      $captureVerdict = "visible"
      $failures.Add("Otto pixels appear in a screen capture (pattern match inside the window was $matchInside)")
    }
  }

  $focusBounds = New-Object System.Drawing.Rectangle(($screen.Left + 40), ($screen.Bottom - 120), 180, 80)
  $form = New-PatternForm $focusBounds
  Click-MouseInput ($focusBounds.Left + 90) ($focusBounds.Top + 40) $PID
  $foregroundBeforeHover = [OttoProbe.Native]::GetForegroundWindow()
  if ($foregroundBeforeHover -ne $form.Handle) {
    throw "The owned focus window must hold foreground before testing hover"
  }
  Move-MouseInput ([int]($screen.Right - 4)) ([int]($screen.Bottom - 4))
  Start-Sleep -Milliseconds 150
  $compact = Get-Rect $hwnd
  $compactSize = Get-RectSize $compact
  $pointerX = [int](($compact.Left + $compact.Right) / 2)
  $pointerY = [int](($compact.Top + $compact.Bottom) / 2)
  Move-MouseInput ($pointerX + 2) $pointerY
  Start-Sleep -Milliseconds 40
  Move-MouseInput $pointerX $pointerY
  $hoverCursor = New-Object OttoProbe.Native+POINT
  [OttoProbe.Native]::GetCursorPos([ref]$hoverCursor) | Out-Null
  $notes.Add("Hover input requested $pointerX,$pointerY; observed $($hoverCursor.X),$($hoverCursor.Y); owner $(Get-PointOwnerPid $hoverCursor.X $hoverCursor.Y)")
  $regionObservations = New-Object System.Collections.Generic.List[object]
  for ($sample = 0; $sample -lt 30; $sample++) {
    $windowWidthNow = (Get-RectSize (Get-HostRect $hwnd)).Width
    $regionNow = Get-WindowRegionBox $hwnd
    $surfaceNow = Get-Rect $hwnd
    $regionObservations.Add([pscustomobject]@{
      Window = $windowWidthNow
      Region = $(if ($null -eq $regionNow) { 0 } else { $regionNow.Width })
      Kind = $(if ($null -eq $regionNow) { 0 } else { $regionNow.Kind })
      Left = $surfaceNow.Left
      Right = $surfaceNow.Right
      Width = $surfaceNow.Right - $surfaceNow.Left
      Center = ($surfaceNow.Left + $surfaceNow.Right) / 2
    })
    if ($windowWidthNow -ne $hostSize.Width) { $failures.Add("navigation resized the native host during morph") }
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 20
  }
  $morphWindowWidth = ($regionObservations | Measure-Object -Property Window -Maximum).Maximum
  $narrowRegionSamples = @($regionObservations | Where-Object { $_.Kind -ne 0 -and $_.Region -lt $_.Window }).Count
  $morphRegion = $null
  if ($narrowRegionSamples -gt 0) {
    $observed = $regionObservations | Where-Object { $_.Kind -ne 0 -and $_.Region -lt $_.Window } | Select-Object -First 1
    $morphRegion = @{ Width = $observed.Region; Height = 0; Kind = $observed.Kind }
  }
  $null = Sample-Morph $hwnd 2500
  $morph = $regionObservations.ToArray()
  $hoverEndCursor = New-Object OttoProbe.Native+POINT
  [OttoProbe.Native]::GetCursorPos([ref]$hoverEndCursor) | Out-Null
  if ($hoverEndCursor.X -ne $pointerX -or $hoverEndCursor.Y -ne $pointerY) {
    throw "Native hover precondition lost: pointer moved from $pointerX,$pointerY to $($hoverEndCursor.X),$($hoverEndCursor.Y) without probe input"
  }
  $preview = Get-Rect $hwnd
  $previewSize = Get-RectSize $preview
  $morphSamples = $morph.Count
  $centerDrift = 0
  $grewLeft = $false
  $grewRight = $false
  if ($morphSamples -ge 2) {
    $centers = $morph | ForEach-Object { $_.Center }
    $centerDrift = [math]::Round((($centers | Measure-Object -Maximum).Maximum - ($centers | Measure-Object -Minimum).Minimum), 1)
    $firstSample = $morph[0]
    $lastSample = $morph[$morphSamples - 1]
    $grewLeft = $lastSample.Left -lt $firstSample.Left
    $grewRight = $lastSample.Right -gt $firstSample.Right
    if ($centerDrift -gt 2) {
      $failures.Add("the morph drifted sideways: the window center moved $centerDrift px")
    }
    if ($lastSample.Width -gt $firstSample.Width -and -not ($grewLeft -and $grewRight)) {
      $failures.Add("the morph grew from one edge instead of the center (left $grewLeft, right $grewRight)")
    }
  } else {
    $notes.Add("the morph finished before it could be sampled")
  }
  $foregroundAfterHover = [OttoProbe.Native]::GetForegroundWindow()
  if ($foregroundAfterHover -ne $foregroundBeforeHover) {
    $failures.Add("hover preview did not preserve the owned foreign window's foreground")
  }
  if ($morphWindowWidth -gt $compactSize.Width) {
    if ($narrowRegionSamples -eq 0) {
      $notes.Add("the hit region was never narrower than the window during sampling; the eased morph is shorter than the sampling window")
    }
  }
  if ($previewSize.Width -le $compactSize.Width) {
    $failures.Add("hover never expanded the surface ($($compactSize.Width)x$($compactSize.Height)); morph, hit-region and pin checks could not run")
  }

  Click-MouseInput $pointerX $pointerY $process.Id
  if (-not (Wait-Interactive $hwnd 5000)) {
    $failures.Add("the clicked surface never settled before pinning was measured")
  }
  $postClickWidth = (Get-RectSize (Get-Rect $hwnd)).Width
  $postClickOwner = Get-PointOwnerPid $pointerX $pointerY
  $pinned = Get-Rect $hwnd
  $pinnedSize = Get-RectSize $pinned
  $foregroundAfterClick = [OttoProbe.Native]::GetForegroundWindow()
  if ($postClickOwner -ne $process.Id -or $foregroundAfterClick -ne $hwnd) {
    $failures.Add("native pointer activation did not reach and focus Otto")
  }
  Move-MouseInput ([int]($screen.Right - 4)) ([int]($screen.Bottom - 4))
  Start-Sleep -Milliseconds 1200
  $afterLeave = Get-Rect $hwnd
  $afterLeaveSize = Get-RectSize $afterLeave
  if ($previewSize.Width -gt $compactSize.Width -and $pinnedSize.Width -le $compactSize.Width) {
    $failures.Add("pointer activation did not pin the preview")
  }
  if ($pinnedSize.Width -gt $compactSize.Width -and $afterLeaveSize.Width -le $compactSize.Width) {
    $failures.Add("the pinned surface collapsed after the pointer left")
  }

  Click-MouseInput ($focusBounds.Left + 90) ($focusBounds.Top + 40) $PID
  $foreignForeground = [OttoProbe.Native]::GetForegroundWindow() -eq $form.Handle
  if (-not $foreignForeground) {
    $failures.Add("native outside click did not focus the owned foreign window")
  }
  if (-not (Wait-Interactive $hwnd 5000)) {
    $failures.Add("the surface never settled after native focus loss")
  }
  $blurCollapsed = (Get-RectSize (Get-Rect $hwnd)).Width -le $compactSize.Width
  $blurHeldPinned = (Get-RectSize (Get-Rect $hwnd)).Width -eq $pinnedSize.Width
  if ($KeepExpanded) {
    if (-not $blurHeldPinned) { $failures.Add("Keep Expanded did not preserve the pinned surface after confirmed focus loss") }
  } elseif (-not $blurCollapsed) {
    $failures.Add("a pinned surface did not collapse after a confirmed outside click")
  }
  if ($blurCollapsed) {
    Move-MouseInput $pointerX $pointerY
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-RectSize (Get-Rect $hwnd)).Width -le $compactSize.Width -and (Get-Date) -lt $deadline) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 50
    }
    $null = Wait-Interactive $hwnd 5000
    Click-MouseInput $pointerX $pointerY $process.Id
    $null = Wait-Interactive $hwnd 5000
  }

  $escapeDelivered = $false
  $escapeWidths = @()
  $escapeCollapsed = $false
  $shrinkHeldWide = $false
  $foregroundBefore = [OttoProbe.Native]::GetForegroundWindow()
  [OttoProbe.Native]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 250
  if ([OttoProbe.Native]::GetForegroundWindow() -eq $hwnd) {
    [OttoProbe.Native]::keybd_event($VK_ESCAPE, 0x01, 0, [UIntPtr]::Zero)
    [OttoProbe.Native]::keybd_event($VK_ESCAPE, 0x01, 2, [UIntPtr]::Zero)
    $escapeDelivered = $true
    for ($sample = 0; $sample -lt 20; $sample++) {
      [System.Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 50
      $escapeWidths += (Get-RectSize (Get-Rect $hwnd)).Width
    }
    $shrinkHeldWide = (Get-RectSize (Get-HostRect $hwnd)).Width -eq $hostSize.Width
    $afterEscape = Get-Rect $hwnd
    $afterEscapeSize = Get-RectSize $afterEscape
    $escapeCollapsed = $afterEscapeSize.Width -le $compactSize.Width
  } else {
    $afterEscapeSize = Get-RectSize (Get-Rect $hwnd)
    $failures.Add("Escape was not sent: Windows refused to foreground the Otto window")
  }
  if ($escapeDelivered -and -not $escapeCollapsed) {
    $failures.Add("Escape reached the focused window but did not restore Compact")
  }
  [OttoProbe.Native]::SetForegroundWindow($foregroundBefore) | Out-Null
  Start-Sleep -Milliseconds 600
  $finalSize = Get-RectSize (Get-Rect $hwnd)
  $finalRegion = Get-WindowRegionBox $hwnd
  if ($null -eq $finalRegion -or $finalRegion.Kind -eq 0) {
    $failures.Add("the settled native window has no silhouette region; rounded corners may intercept desktop clicks")
  }
  $finalHostSize = Get-RectSize (Get-HostRect $hwnd)
  if ($finalHostSize.Width -ne $hostSize.Width -or $finalHostSize.Height -ne $hostSize.Height) {
    $failures.Add("navigation resized the native host")
  }

  $monitor = Get-MonitorBounds $hwnd
  $dpi = [OttoProbe.Native]::GetDpiForWindow($hwnd)
  $scale = if ($dpi -gt 0) { $dpi / 96 } else { 1 }
  $compactWidthCss = $compactSize.Width / $scale
  $compactHeightCss = $compactSize.Height / $scale
  if ([math]::Abs($compactWidthCss - 185) -gt 1 -and [math]::Abs($compactWidthCss - 228) -gt 1) {
    $notes.Add("the compact surface is $([math]::Round($compactWidthCss, 1)) css px wide, which matches neither documented compact surface (185 or 228)")
    $dump = New-Object System.Collections.Generic.List[string]
    $listCallback = [OttoProbe.Native+EnumProc] {
      param($enumHwnd, $enumParam)
      $owner = 0
      [OttoProbe.Native]::GetWindowThreadProcessId($enumHwnd, [ref]$owner) | Out-Null
      if ($owner -eq $process.Id -and [OttoProbe.Native]::IsWindowVisible($enumHwnd)) {
        $rect = New-Object OttoProbe.Native+RECT
        [OttoProbe.Native]::GetWindowRect($enumHwnd, [ref]$rect) | Out-Null
        $name = New-Object System.Text.StringBuilder 128
        [OttoProbe.Native]::GetClassNameW($enumHwnd, $name, 128) | Out-Null
        $dump.Add(("{0}x{1}@{2},{3} class={4} ex=0x{5:X}" -f ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top), $rect.Left, $rect.Top, $name.ToString(), [OttoProbe.Native]::GetWindowLongPtrW($enumHwnd, $GWL_EXSTYLE).ToInt64()))
      }
      return $true
    }
    [OttoProbe.Native]::EnumWindows($listCallback, [IntPtr]::Zero) | Out-Null
    $notes.Add("otto windows: " + ($dump -join "; "))
  }
  $centerOwner = Get-PointOwnerPid ([int](($compact.Left + $compact.Right) / 2)) ([int](($compact.Top + $compact.Bottom) / 2))
  if ($centerOwner -ne $process.Id) {
    $failures.Add("the pointer at the capsule centre is owned by PID $centerOwner instead of Otto ($($process.Id))")
  }

  $observedPlacement = if ([math]::Abs($compact.Top - $monitor.Top) -le 1) { "attached" } else { "floating" }
  $cornerOwners = @()
  $script:passedClicks = 0
  if ($escapeCollapsed) {
    $form.TopMost = $true
    $formStyle = Get-WindowStyle $form.Handle
    if ([OttoProbe.Native]::SetWindowLongPtrW($form.Handle, $GWL_EXSTYLE, [IntPtr]($formStyle -bor 0x08000000)) -eq [IntPtr]::Zero) {
      throw "Cannot make the owned underlay non-activating"
    }
    $form.Bounds = New-Object System.Drawing.Rectangle(($compact.Left - 20), $compact.Top, ($compactSize.Width + 40), ($compactSize.Height + 30))
    $form.add_MouseDown({ $script:passedClicks++ })
    [OttoProbe.Native]::SetWindowPos($form.Handle, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010 -bor 0x0020) | Out-Null
    [OttoProbe.Native]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) | Out-Null
    [System.Windows.Forms.Application]::DoEvents()
    $underlayBounds = Get-HostRect $form.Handle
    $notes.Add("Underlay requested $($form.Bounds); observed $($underlayBounds.Left),$($underlayBounds.Top),$($underlayBounds.Right),$($underlayBounds.Bottom)")
    foreach ($inset in @(1, 2)) {
      $bodyInset = if ($observedPlacement -eq "attached") { [int][math]::Round(12 * $scale) } else { 0 }
      $points = @(
        @(($compact.Left + $inset), ($compact.Top + $inset)),
        @(($compact.Right - $inset), ($compact.Top + $inset)),
        @(($compact.Left + $bodyInset + $inset), ($compact.Bottom - $inset)),
        @(($compact.Right - $bodyInset - $inset), ($compact.Bottom - $inset))
      )
      foreach ($point in $points) {
        $owner = Get-PointOwnerPid $point[0] $point[1]
        $cornerOwners += $owner
        if ($owner -ne $PID) {
          $failures.Add("a transparent corner at $($point[0]),$($point[1]) exposed PID $owner instead of owned PID $PID (surface $((Get-RectSize (Get-Rect $hwnd)).Width)px); click skipped")
          continue
        }
        if ((Get-PointOwnerPid ([int](($compact.Left + $compact.Right) / 2)) ([int](($compact.Top + $compact.Bottom) / 2))) -ne $process.Id) {
          $failures.Add("the underlying window obscured Otto; corner clicks are not usable proof")
          continue
        }
        $expectedClicks = $script:passedClicks + 1
        Click-MouseInput $point[0] $point[1] $PID
        $deadline = (Get-Date).AddSeconds(1)
        while ($script:passedClicks -lt $expectedClicks -and (Get-Date) -lt $deadline) {
          [System.Windows.Forms.Application]::DoEvents()
          Start-Sleep -Milliseconds 10
        }
      }
    }
    if ($script:passedClicks -ne $cornerOwners.Count) { $failures.Add("only $script:passedClicks of $($cornerOwners.Count) native corner clicks reached the underlying window") }
  } else {
    $notes.Add("Compact corner hit-testing not run: Escape did not restore Compact")
  }
  $cornerOtto = @($cornerOwners | Where-Object { $_ -eq $process.Id }).Count
  if ($ExpectPlacement -ne "any" -and $observedPlacement -ne $ExpectPlacement) {
    $failures.Add("expected $ExpectPlacement placement but the window sits at top $($compact.Top) on a monitor starting at $($monitor.Top)")
  }
  if ($observedPlacement -eq "attached") {
    if ($cornerOtto -gt 0) {
      $failures.Add("$cornerOtto of $($cornerOwners.Count) shoulder and corner samples still belong to Otto; the native region does not follow the silhouette")
    }
  } elseif ($cornerOtto -gt 0) {
    $failures.Add("$cornerOtto of $($cornerOwners.Count) floating corner samples belong to Otto; transparent corners still block desktop clicks")
  }

  $report = [ordered]@{
    startup = [ordered]@{
      settledBeforeInteraction = $interactive
      launchedByProbe = $ownsProcess
    }
    window = [ordered]@{
      titleLength = $titleLength
      displayAffinity = ("0x{0:X}" -f $affinity)
      firstVisibleExStyle = $(if ($ownsProcess) { "0x{0:X}" -f $firstStyle } else { $null })
      settledExStyle = ("0x{0:X}" -f $style)
      toolWindow = (Test-ToolWindow $style)
      appWindow = (($style -band $WS_EX_APPWINDOW) -ne 0)
    }
    geometry = [ordered]@{
      compact = "$($compactSize.Width)x$($compactSize.Height)"
      hoverPreview = "$($previewSize.Width)x$($previewSize.Height)"
      pinned = "$($pinnedSize.Width)x$($pinnedSize.Height)"
      pinnedAfterPointerLeave = "$($afterLeaveSize.Width)x$($afterLeaveSize.Height)"
      afterEscape = "$($afterEscapeSize.Width)x$($afterEscapeSize.Height)"
      observedPlacement = $observedPlacement
      expectedPlacement = $ExpectPlacement
      cornerSamplesOwnedByOtto = $cornerOtto
      cornerSamples = $cornerOwners.Count
      nativeClicksReceivedUnderneath = $script:passedClicks
    }
    dpi = [ordered]@{
      value = $dpi
      scale = $scale
      compactWidthCss = [math]::Round($compactWidthCss, 2)
      compactHeightCss = [math]::Round($compactHeightCss, 2)
      renderedAlignment = "Not measured by Win32 region bounds; run transitions-native for WebView edge assertions"
      monitorTop = $monitor.Top
      monitorLeft = $monitor.Left
    }
    hitRegion = [ordered]@{
      windowWidthDuringMorph = $morphWindowWidth
      regionWidthDuringMorph = $(if ($null -eq $morphRegion) { 0 } else { $morphRegion.Width })
      narrowRegionSamples = $narrowRegionSamples
      regionKindDuringMorph = $(if ($null -eq $morphRegion) { 0 } else { $morphRegion.Kind })
      regionAtRest = $(if ($null -eq $finalRegion) { 0 } else { $finalRegion.Kind })
    }
    click = [ordered]@{
      widthAfterClick = $postClickWidth
      pointerOwnerAfterClick = $postClickOwner
      ownerIsOtto = ($postClickOwner -eq $process.Id)
      focusedOtto = ($foregroundAfterClick -eq $hwnd)
    }
    shrink = [ordered]@{
      heldWideImmediatelyAfterEscape = $shrinkHeldWide
      collapsedAfterSettle = $escapeCollapsed
    }
    morph = [ordered]@{
      samples = $morphSamples
      centerDriftPx = $centerDrift
      grewLeft = $grewLeft
      grewRight = $grewRight
      jumpedToTarget = ($previewSize.Width -gt $compactSize.Width -and @($morph | Where-Object { $_.Width -gt $compactSize.Width + 1 -and $_.Width -lt $previewSize.Width - 1 }).Count -eq 0)
    }
    focus = [ordered]@{
      hoverKeptForeground = ($foregroundAfterHover -eq $foregroundBeforeHover)
      foregroundBeforeHover = $foregroundBeforeHover.ToInt64()
      foregroundAfterHover = $foregroundAfterHover.ToInt64()
      hoverForegroundWasOtto = ($foregroundAfterHover -eq $hwnd)
      outsideClickFocusedForeignWindow = $foreignForeground
      outsideClickCollapsedPinned = $blurCollapsed
      keepExpandedExpected = [bool]$KeepExpanded
      outsideClickHeldPinned = $blurHeldPinned
    }
    capture = [ordered]@{
      verdict = $captureVerdict
      patternMatchInsideWindow = $matchInside
      patternMatchOutsideWindow = $matchOutside
    }
    escape = [ordered]@{
      delivered = $escapeDelivered
      collapsed = $escapeCollapsed
      widthSamples = $escapeWidths
    }
    notes = @($notes)
    failures = @($failures)
  }
  $report | ConvertTo-Json -Depth 5
  if ($failures.Count -gt 0) {
    Write-Output "FAIL: shell native probe"
    exit 1
  }
  Write-Output "PASS: shell native probe"
} finally {
  [OttoProbe.Native]::SetCursorPos($origin.X, $origin.Y) | Out-Null
  if ($form) { $form.Close(); $form.Dispose() }
  if ($ownsProcess) { Stop-Otto $process }
  Remove-Item Env:\WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  if ($profile -and (Test-Path $profile) -and ($null -eq $process -or $process.HasExited)) {
    Start-Sleep -Milliseconds 500
    Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
  }
}
