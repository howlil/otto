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

    $owned = @(
      foreach ($processId in $processIds) {
        Get-Process -Id $processId -ErrorAction SilentlyContinue
      }
    )
    $privateBytes = ($owned | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
    $residentBytes = ($owned | Measure-Object -Property WorkingSet64 -Sum).Sum

    [pscustomobject]@{
      Timestamp = (Get-Date).ToString("o")
      OttoInstances = $roots.Count
      ProcessCount = $owned.Count
      PrivateMiB = [math]::Round($privateBytes / 1MB, 1)
      WorkingSetMiB = [math]::Round($residentBytes / 1MB, 1)
      WebView2Processes = @($owned | Where-Object { $_.ProcessName -ieq "msedgewebview2" }).Count
    }
    if ($sample -lt ($Samples - 1)) { Start-Sleep -Seconds $IntervalSeconds }
  }
)
$measurements | Export-Csv -Path $Output -NoTypeInformation
$measurements | Select-Object -Last 1
