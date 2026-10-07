param([string]$LocalTools, [ValidateSet('Auto','System','Local')][string]$Preference = 'Auto')
$ErrorActionPreference = 'Stop'
$readerWorkspace = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$readerLocal = if ($LocalTools) { [IO.Path]::GetFullPath($LocalTools) } else { Join-Path $readerWorkspace '.tools' }
function Test-ReaderExternalLocation([string]$Path, [switch]$AllowRustProxy) {
  $readerResolvedPath = [IO.Path]::GetFullPath($Path)
  if ($readerResolvedPath.StartsWith($readerWorkspace + '\', [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $readerAncestor = Get-Item -LiteralPath $readerResolvedPath -ErrorAction SilentlyContinue
  # Recent Rustup installers create cargo.exe -> rustup.exe proxies on Windows.
  if ($AllowRustProxy -and $readerAncestor.LinkType -eq 'SymbolicLink' -and $readerAncestor.Target -eq 'rustup.exe') {
    return Test-ReaderExternalLocation (Join-Path $readerAncestor.DirectoryName 'rustup.exe')
  }
  while ($readerAncestor) {
    if ($readerAncestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
    $readerAncestor = if ($readerAncestor.PSIsContainer) { $readerAncestor.Parent } else { $readerAncestor.Directory }
  }
  return $true
}
$readerVswhere = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$readerVisualStudio = $null
if ($readerVswhere) {
  $readerVisualStudio = & $readerVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($LASTEXITCODE -ne 0 -or ($readerVisualStudio -and -not (Test-ReaderExternalLocation $readerVisualStudio))) { $readerVisualStudio = $null }
}
$readerCandidates = @()
$readerCandidates += @(Get-Command cargo.exe -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
$readerCandidates += Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
foreach ($readerScope in @('User','Machine')) {
  $readerCargoHome = [Environment]::GetEnvironmentVariable('CARGO_HOME', $readerScope)
  if ($readerCargoHome) { $readerCandidates += Join-Path $readerCargoHome 'bin\cargo.exe' }
  $readerEnvPath = [Environment]::GetEnvironmentVariable('Path', $readerScope)
  foreach ($readerEntry in ($readerEnvPath -split ';')) {
    if ($readerEntry) { $readerCandidates += Join-Path ([Environment]::ExpandEnvironmentVariables($readerEntry)) 'cargo.exe' }
  }
}
$readerSystem = $null
if ($Preference -ne 'Local' -and $readerVisualStudio) {
  foreach ($readerCandidate in ($readerCandidates | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $readerCandidate -PathType Leaf)) { continue }
    $readerCargoPath = (Resolve-Path -LiteralPath $readerCandidate).Path
    if (-not (Test-ReaderExternalLocation $readerCargoPath -AllowRustProxy)) { continue }
    $readerCargoBin = Split-Path -Parent $readerCargoPath
    $readerRustup = Join-Path $readerCargoBin 'rustup.exe'
    if (-not (Test-Path -LiteralPath $readerRustup)) { continue }
    $readerRustupHome = [Environment]::GetEnvironmentVariable('RUSTUP_HOME', 'User')
    if (-not $readerRustupHome) { $readerRustupHome = [Environment]::GetEnvironmentVariable('RUSTUP_HOME', 'Machine') }
    if (-not $readerRustupHome) { $readerRustupHome = Join-Path $env:USERPROFILE '.rustup' }
    if (-not (Test-ReaderExternalLocation $readerRustupHome)) { continue }
    $readerPriorCargo = $env:CARGO_HOME
    $readerPriorRustup = $env:RUSTUP_HOME
    try {
      $env:CARGO_HOME = Split-Path -Parent $readerCargoBin
      $env:RUSTUP_HOME = $readerRustupHome
      $readerInstalled = & $readerRustup toolchain list
      if ($LASTEXITCODE -eq 0 -and ($readerInstalled -match '^stable-x86_64-pc-windows-msvc(?: |$)')) {
        $readerSystem = [pscustomobject]@{ kind='System'; cargo=$readerCargoPath; cargoHome=$env:CARGO_HOME; rustupHome=$readerRustupHome; toolchain='stable-x86_64-pc-windows-msvc'; cpp=$readerVisualStudio; linker=$null }
        break
      }
    } finally { $env:CARGO_HOME=$readerPriorCargo; $env:RUSTUP_HOME=$readerPriorRustup }
  }
}
if ($readerSystem) { return $readerSystem }
if ($Preference -ne 'System') {
  $readerCargo = Join-Path $readerLocal 'cargo\bin\cargo.exe'
  $readerGcc = Join-Path $readerLocal 'gcc-mingw\bin\x86_64-w64-mingw32-gcc.exe'
  if ((Test-Path -LiteralPath $readerCargo) -and (Test-Path -LiteralPath $readerGcc)) {
    return [pscustomobject]@{ kind='Local'; cargo=$readerCargo; cargoHome=(Join-Path $readerLocal 'cargo'); rustupHome=(Join-Path $readerLocal 'rustup'); toolchain='stable-x86_64-pc-windows-gnu'; cpp=(Join-Path $readerLocal 'gcc-mingw'); linker=$readerGcc }
  }
}
return [pscustomobject]@{ kind='Missing'; cargo=$null; cargoHome=$null; rustupHome=$null; toolchain=$null; cpp=$readerVisualStudio; linker=$null }
