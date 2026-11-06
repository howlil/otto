param(
  [string]$App = (Join-Path $PSScriptRoot "..\..\src-tauri\target\debug\otto.exe"),
  [ValidateSet("any", "floating", "attached")][string]$ExpectPlacement = "any"
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

function Get-Rect($hwnd) {
  $rect = New-Object OttoProbe.Native+RECT
  [OttoProbe.Native]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
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
  $mouse.dwFlags = 0x0001 -bor 0x8000
  $input = New-Object OttoProbe.Native+INPUT
  $input.type = 0
  $input.mi = $mouse
  $inputs = [OttoProbe.Native+INPUT[]]@($input)
  $sent = [OttoProbe.Native]::SendInput(1, $inputs, [Runtime.InteropServices.Marshal]::SizeOf($inputs[0]))
  if ($sent -ne 1) {
    throw "SendInput failed while moving the pointer to $x,$y"
  }
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
      $box = @{ Width = $rect.Right - $rect.Left; Height = $rect.Bottom - $rect.Top; Kind = $kind }
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
    Start-Sleep -Milliseconds 100
  }
  return $false
}

function Stop-Otto($process, [string]$app) {
  if ($null -eq $process) { return }
  if (-not $process.HasExited) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  }
  $deadline = (Get-Date).AddSeconds(3)
  while ((Get-Date) -lt $deadline -and (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 100
  }
  $strays = @(Get-Process otto -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $app })
  if ($strays.Count -gt 0) {
    & taskkill.exe /IM otto.exe /F | Out-Null
    Start-Sleep -Milliseconds 500
  }
}

function Wait-RectChange($hwnd, $previous, [int]$timeoutMs = 1500) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  $rect = Get-Rect $hwnd
  while ((Get-Date) -lt $deadline) {
    $size = Get-RectSize $rect
    $prevSize = Get-RectSize $previous
    if ($size.Width -ne $prevSize.Width -or $size.Height -ne $prevSize.Height) { return $rect }
    Start-Sleep -Milliseconds 60
    $rect = Get-Rect $hwnd
  }
  return $rect
}

if (-not (Test-Path $App)) { throw "Build the debug Tauri binary first: $App" }
$running = @(Get-Process otto -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  throw "Close the running Otto instance (PID $($running.Id -join ',')) first (taskkill /IM otto.exe /F); the single-instance guard exits a second process."
}

$origin = New-Object OttoProbe.Native+POINT
[OttoProbe.Native]::GetCursorPos([ref]$origin) | Out-Null
$failures = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]
$process = $null
$profile = $null
$form = $null

try {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $patternBounds = New-Object System.Drawing.Rectangle(($screen.Left + [int](($screen.Width - 900) / 2)), $screen.Top, 900, 320)
  $form = New-PatternForm $patternBounds
  $backdropRegion = New-Object OttoProbe.Native+RECT
  $backdropRegion.Left = $patternBounds.Left + 8; $backdropRegion.Top = $patternBounds.Top + 8
  $backdropRegion.Right = $backdropRegion.Left + 300; $backdropRegion.Bottom = $backdropRegion.Top + 120
  $backdropReady = Measure-PatternMatch $backdropRegion
  if ($backdropReady -lt 0.9) {
    throw "Pattern backdrop did not render (match $backdropReady); close other top windows or rerun."
  }

  $profile = Join-Path ([System.IO.Path]::GetTempPath()) ("otto-shell-probe-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $profile | Out-Null
  $env:WEBVIEW2_USER_DATA_FOLDER = $profile
  [OttoProbe.Native]::SetCursorPos([int]($screen.Right - 4), [int]($screen.Bottom - 4)) | Out-Null
  Start-Sleep -Milliseconds 200
  $stdoutPath = Join-Path $profile 'otto-startup.stdout.log'
  $stderrPath = Join-Path $profile 'otto-startup.stderr.log'
  $process = Start-Process -FilePath $App -WorkingDirectory (Split-Path -Parent $App) -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
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
    $details = Get-StartupDiagnostics $process.Id $stdoutPath $stderrPath
    throw "Otto startup failed after $($startup.ElapsedMilliseconds)ms (PID $($process.Id), $exitStatus). $details"
  }

  [OttoProbe.Native]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) | Out-Null
  $firstStyle = Get-WindowStyle $hwnd
  $interactive = Wait-Interactive $hwnd 8000
  if (-not $interactive) {
    $notes.Add("the window never settled on a stable tool-window geometry; interactions may be unreliable")
  }
  Start-Sleep -Milliseconds 300
  $style = Get-WindowStyle $hwnd
  $titleLength = [OttoProbe.Native]::GetWindowTextLengthW($hwnd)
  $affinity = 0
  [OttoProbe.Native]::GetWindowDisplayAffinity($hwnd, [ref]$affinity) | Out-Null

  if ($titleLength -ne 0) { $failures.Add("window title is not blank (length $titleLength)") }
  if (-not (Test-ToolWindow $style)) { $failures.Add(("window is not an untitled tool window (exstyle 0x{0:X})" -f $style)) }
  if ($affinity -ne $EXCLUDE_FROM_CAPTURE) { $failures.Add(("display affinity is 0x{0:X} instead of 0x11" -f $affinity)) }
  if (-not (Test-ToolWindow $firstStyle)) {
    $failures.Add(("first visible frame was a taskbar app window (exstyle 0x{0:X}); overlay styling must run before the window is shown" -f $firstStyle))
  }

  $compact = Get-Rect $hwnd
  $compactSize = Get-RectSize $compact

  $ottoRegion = New-Object OttoProbe.Native+RECT
  $ottoRegion.Left = $compact.Left; $ottoRegion.Top = $compact.Top
  $ottoRegion.Right = $compact.Right; $ottoRegion.Bottom = $compact.Bottom
  $matchInside = Measure-PatternMatch $ottoRegion
  $controlRegion = New-Object OttoProbe.Native+RECT
  $controlRegion.Left = $patternBounds.Left + 8; $controlRegion.Top = $patternBounds.Top + 8
  $controlRegion.Right = $controlRegion.Left + $compactSize.Width; $controlRegion.Bottom = $controlRegion.Top + $compactSize.Height
  $matchOutside = Measure-PatternMatch $controlRegion

  if ($form) {
    $form.Close()
    $form.Dispose()
    $form = $null
    Start-Sleep -Milliseconds 300
    $compact = Get-Rect $hwnd
    $compactSize = Get-RectSize $compact
  }

  $captureVerdict = "inconclusive"
  if ($matchOutside -lt 0.6) {
    $notes.Add("backdrop pattern was not visible outside Otto (match $matchOutside); capture verdict is not usable")
  } elseif ($matchInside -ge 0.8) {
    $captureVerdict = "excluded"
  } elseif ($matchInside -le 0.3) {
    $captureVerdict = "visible"
    $failures.Add("Otto pixels appear in a screen capture (pattern match inside the window was $matchInside)")
  }

  $foregroundBeforeHover = [OttoProbe.Native]::GetForegroundWindow()
  Move-MouseInput ([int]($screen.Right - 4)) ([int]($screen.Bottom - 4))
  Start-Sleep -Milliseconds 150
  $compact = Get-Rect $hwnd
  $compactSize = Get-RectSize $compact
  $pointerX = [int](($compact.Left + $compact.Right) / 2)
  $pointerY = [int](($compact.Top + $compact.Bottom) / 2)
  Move-MouseInput ($pointerX + 2) $pointerY
  Start-Sleep -Milliseconds 40
  Move-MouseInput $pointerX $pointerY
  $regionObservations = New-Object System.Collections.Generic.List[object]
  for ($sample = 0; $sample -lt 30; $sample++) {
    $windowWidthNow = (Get-RectSize (Get-Rect $hwnd)).Width
    $regionNow = Get-WindowRegionBox $hwnd
    $regionObservations.Add([pscustomobject]@{
      Window = $windowWidthNow
      Region = $(if ($null -eq $regionNow) { 0 } else { $regionNow.Width })
      Kind = $(if ($null -eq $regionNow) { 0 } else { $regionNow.Kind })
    })
    Start-Sleep -Milliseconds 20
  }
  $morphWindowWidth = ($regionObservations | Measure-Object -Property Window -Maximum).Maximum
  $narrowRegionSamples = @($regionObservations | Where-Object { $_.Kind -ne 0 -and $_.Region -lt $_.Window }).Count
  $morphRegion = $null
  if ($narrowRegionSamples -gt 0) {
    $observed = $regionObservations | Where-Object { $_.Kind -ne 0 -and $_.Region -lt $_.Window } | Select-Object -First 1
    $morphRegion = @{ Width = $observed.Region; Height = 0; Kind = $observed.Kind }
  }
  $morph = Sample-Morph $hwnd 2500
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
  if ($foregroundAfterHover -eq $hwnd -and $foregroundBeforeHover -ne $hwnd) {
    $failures.Add("hover preview took foreground focus")
  }
  if ($morphWindowWidth -gt $compactSize.Width) {
    if ($narrowRegionSamples -eq 0) {
      $notes.Add("the hit region was never narrower than the window during sampling; the eased morph is shorter than the sampling window")
    }
  }
  if ($previewSize.Width -le $compactSize.Width) {
    $failures.Add("hover never expanded the surface ($($compactSize.Width)x$($compactSize.Height)); morph, hit-region and pin checks could not run")
  }

  [OttoProbe.Native]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [OttoProbe.Native]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 250
  $postClickWidth = (Get-RectSize (Get-Rect $hwnd)).Width
  $postClickOwner = Get-PointOwnerPid $pointerX $pointerY
  $pinned = Wait-RectChange $hwnd $preview 2500
  $pinnedSize = Get-RectSize $pinned
  [OttoProbe.Native]::SetCursorPos($origin.X, $origin.Y) | Out-Null
  Start-Sleep -Milliseconds 1200
  $afterLeave = Get-Rect $hwnd
  $afterLeaveSize = Get-RectSize $afterLeave
  if ($previewSize.Width -gt $compactSize.Width -and $pinnedSize.Width -le $compactSize.Width) {
    $failures.Add("pointer activation did not pin the preview")
  }
  if ($pinnedSize.Width -gt $compactSize.Width -and $afterLeaveSize.Width -le $compactSize.Width) {
    $failures.Add("the pinned surface collapsed after the pointer left")
  }

  $escapeDelivered = $false
  $escapeCollapsed = $false
  $shrinkHeldWide = $false
  $foregroundBefore = [OttoProbe.Native]::GetForegroundWindow()
  [OttoProbe.Native]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 250
  if ([OttoProbe.Native]::GetForegroundWindow() -eq $hwnd) {
    [OttoProbe.Native]::keybd_event($VK_ESCAPE, 0x01, 0, [UIntPtr]::Zero)
    [OttoProbe.Native]::keybd_event($VK_ESCAPE, 0x01, 2, [UIntPtr]::Zero)
    $escapeDelivered = $true
    Start-Sleep -Milliseconds 80
    $shrinkHeldWide = (Get-RectSize (Get-Rect $hwnd)).Width -gt $compactSize.Width
    Start-Sleep -Milliseconds 900
    $afterEscape = Get-Rect $hwnd
    $afterEscapeSize = Get-RectSize $afterEscape
    $escapeCollapsed = $afterEscapeSize.Width -le $compactSize.Width
  } else {
    $afterEscapeSize = Get-RectSize (Get-Rect $hwnd)
    $notes.Add("Escape was not sent: Windows refused to foreground the Otto window")
  }
  [OttoProbe.Native]::SetForegroundWindow($foregroundBefore) | Out-Null
  Start-Sleep -Milliseconds 600
  $finalSize = Get-RectSize (Get-Rect $hwnd)
  $finalRegion = Get-WindowRegionBox $hwnd
  if ($null -eq $finalRegion -or $finalRegion.Kind -eq 0) {
    $failures.Add("the settled native window has no silhouette region; rounded corners may intercept desktop clicks")
  }
  if ($null -ne $finalRegion -and $finalRegion.Width -lt $finalSize.Width) {
    $failures.Add("a clipping window region was left at rest (window $($finalSize.Width) px, region $($finalRegion.Width) px)")
  }

  $monitor = Get-MonitorBounds $hwnd
  $dpi = [OttoProbe.Native]::GetDpiForWindow($hwnd)
  $scale = if ($dpi -gt 0) { $dpi / 96 } else { 1 }
  $compactWidthCss = $compactSize.Width / $scale
  $compactHeightCss = $compactSize.Height / $scale
  $scaleAligned = ([math]::Abs($compactWidthCss - [math]::Round($compactWidthCss)) -le 1) -and
    ([math]::Abs($compactHeightCss - [math]::Round($compactHeightCss)) -le 1)
  if ([math]::Abs($compactWidthCss - 92) -gt 1 -and [math]::Abs($compactWidthCss - 228) -gt 1) {
    $notes.Add("the compact surface is $([math]::Round($compactWidthCss, 1)) css px wide, which matches neither documented compact surface (92 or 228)")
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
  if (-not $scaleAligned) {
    $failures.Add("native surface does not land on whole device pixels at scale $scale ($($compactSize.Width)x$($compactSize.Height))")
  }

  $centerOwner = Get-PointOwnerPid ([int](($compact.Left + $compact.Right) / 2)) ([int](($compact.Top + $compact.Bottom) / 2))
  if ($centerOwner -ne $process.Id) {
    $failures.Add("the pointer at the capsule centre is owned by PID $centerOwner instead of Otto ($($process.Id))")
  }

  $cornerOwners = @()
  foreach ($inset in @(2, 4)) {
    $cornerOwners += (Get-PointOwnerPid ($compact.Left + $inset) ($compact.Top + $inset))
    $cornerOwners += (Get-PointOwnerPid ($compact.Right - $inset) ($compact.Top + $inset))
    $cornerOwners += (Get-PointOwnerPid ($compact.Left + $inset) ($compact.Bottom - $inset))
    $cornerOwners += (Get-PointOwnerPid ($compact.Right - $inset) ($compact.Bottom - $inset))
  }
  $cornerOtto = @($cornerOwners | Where-Object { $_ -eq $process.Id }).Count
  $observedPlacement = if ([math]::Abs($compact.Top - $monitor.Top) -le 1) { "attached" } else { "floating" }
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
    }
    window = [ordered]@{
      titleLength = $titleLength
      displayAffinity = ("0x{0:X}" -f $affinity)
      firstVisibleExStyle = ("0x{0:X}" -f $firstStyle)
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
    }
    dpi = [ordered]@{
      value = $dpi
      scale = $scale
      compactWidthCss = [math]::Round($compactWidthCss, 2)
      compactHeightCss = [math]::Round($compactHeightCss, 2)
      wholeDevicePixels = $scaleAligned
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
      jumpedToTarget = $(if ($morphSamples -gt 0) { $morph[$morphSamples - 1].Width -eq $previewSize.Width } else { $false })
    }
    focus = [ordered]@{
      hoverKeptForeground = ($foregroundAfterHover -eq $foregroundBeforeHover)
      hoverForegroundWasOtto = ($foregroundAfterHover -eq $hwnd)
    }
    capture = [ordered]@{
      verdict = $captureVerdict
      patternMatchInsideWindow = $matchInside
      patternMatchOutsideWindow = $matchOutside
    }
    escape = [ordered]@{
      delivered = $escapeDelivered
      collapsed = $escapeCollapsed
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
  Stop-Otto $process $App
  Remove-Item Env:\WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  if ($profile -and (Test-Path $profile)) {
    Start-Sleep -Milliseconds 500
    Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
  }
}
