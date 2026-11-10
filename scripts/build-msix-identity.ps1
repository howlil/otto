param(
  [ValidatePattern('^CN=.+')][string]$Publisher = 'CN=Otto Development',
  [ValidateSet('debug', 'release')][string]$Profile = 'debug',
  [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'

function Find-SdkTool([string]$Name) {
  $command = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue
  if ($command) { return $command.Path }

  $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (-not (Test-Path -LiteralPath $kitsRoot)) {
    throw "Windows SDK tools directory is unavailable: $kitsRoot"
  }

  $candidates = @(
    Get-ChildItem -LiteralPath $kitsRoot -Directory |
      Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
      Sort-Object { [version]$_.Name } -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\$Name" } |
      Where-Object { Test-Path -LiteralPath $_ }
  )
  if ($candidates.Count -eq 0) {
    throw "$Name was not found on PATH or in $kitsRoot"
  }

  return $candidates[0]
}

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tauriDirectory = Join-Path $root 'src-tauri'
$config = Get-Content -LiteralPath (Join-Path $tauriDirectory 'tauri.conf.json') -Raw | ConvertFrom-Json
$identityName = [string]$config.identifier
$applicationId = 'Otto'
$publisher = $Publisher.Trim()

if ($identityName -ne 'site.howlil.otto') {
  throw "The identity package name must match the embedded manifest: $identityName"
}
if ([string]::IsNullOrWhiteSpace($publisher)) {
  throw 'Publisher must not be empty.'
}
if ([string]$config.version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Tauri version must be semantic X.Y.Z: $($config.version)"
}

$packageVersion = "$($config.version).0"
$artifactDirectory = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $tauriDirectory 'target\msix-identity'
}
$stagingDirectory = Join-Path $artifactDirectory 'package'
$unpackedDirectory = Join-Path $artifactDirectory 'unpacked'
$packagePath = Join-Path $artifactDirectory "otto-identity-$Profile.msix"
$embeddedManifestPath = Join-Path $artifactDirectory "otto-$Profile.manifest.xml"

New-Item -ItemType Directory -Force -Path $artifactDirectory, $stagingDirectory, $unpackedDirectory | Out-Null

$previousPublisher = $env:OTTO_MSIX_PUBLISHER
try {
  $env:OTTO_MSIX_PUBLISHER = $publisher
  $buildArguments = @('run', 'tauri', 'build', '--no-bundle')
  if ($Profile -eq 'debug') { $buildArguments += '--debug' }
  & bun @buildArguments
  if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed.' }
} finally {
  $env:OTTO_MSIX_PUBLISHER = $previousPublisher
}

$binaryPath = Join-Path $tauriDirectory "target\$Profile\otto.exe"
if (-not (Test-Path -LiteralPath $binaryPath)) {
  throw "Built Otto executable is unavailable: $binaryPath"
}

$manifestTool = Find-SdkTool 'mt.exe'
& $manifestTool "-inputresource:$binaryPath;#1" "-out:$embeddedManifestPath"
if ($LASTEXITCODE -ne 0) { throw 'Manifest extraction failed.' }

[xml]$embeddedManifest = Get-Content -LiteralPath $embeddedManifestPath -Raw
$embeddedNamespaces = [System.Xml.XmlNamespaceManager]::new($embeddedManifest.NameTable)
$embeddedNamespaces.AddNamespace('assembly', 'urn:schemas-microsoft-com:asm.v1')
$embeddedNamespaces.AddNamespace('msix', 'urn:schemas-microsoft-com:msix.v1')
$identityNode = $embeddedManifest.SelectSingleNode('/assembly:assembly/msix:msix', $embeddedNamespaces)
if ($null -eq $identityNode -or
    $identityNode.GetAttribute('publisher') -ne $publisher -or
    $identityNode.GetAttribute('packageName') -ne $identityName -or
    $identityNode.GetAttribute('applicationId') -ne $applicationId) {
  throw 'The executable does not contain the requested MSIX identity metadata.'
}

$escapedPublisher = [System.Security.SecurityElement]::Escape($publisher)
$packageManifestPath = Join-Path $stagingDirectory 'AppxManifest.xml'
$packageManifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package IgnorableNamespaces="uap uap7 uap10 rescap"
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap7="http://schemas.microsoft.com/appx/manifest/uap/windows10/7"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="$identityName" Publisher="$escapedPublisher" Version="$packageVersion" ProcessorArchitecture="neutral" />
  <Properties>
    <DisplayName>Otto</DisplayName>
    <PublisherDisplayName>Otto</PublisherDisplayName>
    <Logo>Assets\storelogo.png</Logo>
    <uap10:AllowExternalContent>true</uap10:AllowExternalContent>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
    <uap7:Capability Name="globalMediaControl" />
  </Capabilities>
  <Applications>
    <Application Id="$applicationId" Executable="otto.exe" uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App">
      <uap:VisualElements AppListEntry="none" DisplayName="Otto" Description="Otto desktop companion" BackgroundColor="transparent" Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
</Package>
"@
[System.IO.File]::WriteAllText($packageManifestPath, $packageManifest, [System.Text.UTF8Encoding]::new($false))

$makeAppx = Find-SdkTool 'makeappx.exe'
& $makeAppx pack /o /d $stagingDirectory /nv /p $packagePath
if ($LASTEXITCODE -ne 0) { throw 'MSIX package creation failed.' }
& $makeAppx unpack /o /nv /p $packagePath /d $unpackedDirectory
if ($LASTEXITCODE -ne 0) { throw 'MSIX package verification failed.' }

[xml]$unpackedManifest = Get-Content -LiteralPath (Join-Path $unpackedDirectory 'AppxManifest.xml') -Raw
$packageNamespaces = [System.Xml.XmlNamespaceManager]::new($unpackedManifest.NameTable)
$packageNamespaces.AddNamespace('foundation', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$packageNamespaces.AddNamespace('uap7', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/7')
$packageNamespaces.AddNamespace('uap10', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10')
$packageNamespaces.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')
$packageIdentity = $unpackedManifest.SelectSingleNode('/foundation:Package/foundation:Identity', $packageNamespaces)
$mediaCapability = $unpackedManifest.SelectSingleNode('/foundation:Package/foundation:Capabilities/uap7:Capability[@Name="globalMediaControl"]', $packageNamespaces)
$externalContent = $unpackedManifest.SelectSingleNode('/foundation:Package/foundation:Properties/uap10:AllowExternalContent', $packageNamespaces)
$fullTrust = $unpackedManifest.SelectSingleNode('/foundation:Package/foundation:Capabilities/rescap:Capability[@Name="runFullTrust"]', $packageNamespaces)
$unvirtualizedResources = $unpackedManifest.SelectSingleNode('/foundation:Package/foundation:Capabilities/rescap:Capability[@Name="unvirtualizedResources"]', $packageNamespaces)
$application = $unpackedManifest.SelectSingleNode('/foundation:Package/foundation:Applications/foundation:Application', $packageNamespaces)

if ($null -eq $packageIdentity -or
    $packageIdentity.GetAttribute('Name') -ne $identityName -or
    $packageIdentity.GetAttribute('Publisher') -ne $publisher -or
    $packageIdentity.GetAttribute('ProcessorArchitecture') -ne 'neutral' -or
    $null -eq $mediaCapability -or
    $null -eq $externalContent -or
    $externalContent.InnerText.Trim() -ne 'true' -or
    $null -eq $fullTrust -or
    $null -eq $unvirtualizedResources -or
    $null -eq $application -or
    $application.GetAttribute('Id') -ne $applicationId -or
    $application.GetAttribute('Executable') -ne 'otto.exe' -or
    $application.GetAttribute('TrustLevel', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10') -ne 'mediumIL' -or
    $application.GetAttribute('RuntimeBehavior', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10') -ne 'win32App') {
  throw 'The generated MSIX package does not meet the identity and media capability contract.'
}

[pscustomobject]@{
  package = $packagePath
  executable = $binaryPath
  publisher = $publisher
  identityName = $identityName
  applicationId = $applicationId
  signed = $false
  registered = $false
} | ConvertTo-Json -Compress
