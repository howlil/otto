param(
  [ValidateRange(1, 3600)][int]$Samples = 60,
  [ValidateRange(1, 60)][int]$IntervalSeconds = 1,
  [string]$Output = "otto-memory.csv"
)

$measurements = @(
  for ($sample = 0; $sample -lt $Samples; $sample++) {
    $processTable = @(Get-CimInstance Win32_Process)
    $roots = @($processTable | Where-Object { $_.Name -ieq "Otto.exe" })
    $processIds = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($root in $roots) { [void]$processIds.Add([int]$root.ProcessId) }

    do {
      $added = 0
      foreach ($entry in $processTable) {
        if ($processIds.Contains([int]$entry.ParentProcessId) -and
            $processIds.Add([int]$entry.ProcessId)) {
          $added++
        }
      }
    } while ($added -gt 0)

    $byId = @{}
    foreach ($entry in $processTable) { $byId[[int]$entry.ProcessId] = $entry }

    $owned = @(
      foreach ($processId in $processIds) {
        Get-Process -Id $processId -ErrorAction SilentlyContinue
      }
    )
    $privateBytes = ($owned | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
    $residentBytes = ($owned | Measure-Object -Property WorkingSet64 -Sum).Sum
    $cpuSeconds = ($owned | Measure-Object -Property CPU -Sum).Sum

    $roleBytes = @{
      otto = 0L
      gpu = 0L
      renderer = 0L
      browser = 0L
      utility = 0L
      cli = 0L
    }
    foreach ($proc in $owned) {
      $cmd = $byId[$proc.Id].CommandLine
      $priv = [int64]$proc.PrivateMemorySize64
      if ($proc.ProcessName -ieq "Otto") {
        $roleBytes.otto += $priv
      } elseif ($proc.ProcessName -ieq "msedgewebview2") {
        if ($cmd -match "--type=gpu-process") { $roleBytes.gpu += $priv }
        elseif ($cmd -match "--type=renderer") { $roleBytes.renderer += $priv }
        elseif ($cmd -match "--type=utility" -or $cmd -match "--type=crashpad-handler") { $roleBytes.utility += $priv }
        else { $roleBytes.browser += $priv }
      } else {
        $roleBytes.cli += $priv
      }
    }

    [pscustomobject]@{
      Timestamp = (Get-Date).ToString("o")
      OttoInstances = $roots.Count
      ProcessCount = $owned.Count
      PrivateMiB = [math]::Round($privateBytes / 1MB, 1)
      WorkingSetMiB = [math]::Round($residentBytes / 1MB, 1)
      WebView2Processes = @($owned | Where-Object { $_.ProcessName -ieq "msedgewebview2" }).Count
      OttoMiB = [math]::Round($roleBytes.otto / 1MB, 1)
      GpuMiB = [math]::Round($roleBytes.gpu / 1MB, 1)
      RendererMiB = [math]::Round($roleBytes.renderer / 1MB, 1)
      BrowserMiB = [math]::Round($roleBytes.browser / 1MB, 1)
      UtilityMiB = [math]::Round($roleBytes.utility / 1MB, 1)
      CliMiB = [math]::Round($roleBytes.cli / 1MB, 1)
      CpuSeconds = [math]::Round($cpuSeconds, 2)
    }
    if ($sample -lt ($Samples - 1)) { Start-Sleep -Seconds $IntervalSeconds }
  }
)
$measurements | Export-Csv -Path $Output -NoTypeInformation
$measurements | Select-Object -Last 1
