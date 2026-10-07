param(
  [ValidateSet('Dev','Build','Check','Test','Package','Run','InspectTools','CleanupTools','CleanCache')][string]$Action = 'Run',
  [string]$Book = '',
  [string]$ToolsDir = '',
  [string]$TargetDir = '',
  [ValidateSet('Auto','System','Local')][string]$Toolchain = 'Auto'
)
$ErrorActionPreference = 'Stop'
$readerRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $readerRoot
if ($Action -eq 'CleanCache') {
  $readerDefaultCache = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AnimeRead\build-cache'))
  if (Test-Path -LiteralPath $readerDefaultCache) {
    $readerResolvedCache = (Resolve-Path -LiteralPath $readerDefaultCache).Path
    if ($readerResolvedCache -ne $readerDefaultCache -or (Get-Item -LiteralPath $readerResolvedCache).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '缓存位置异常，不清理' }
    if (Get-ChildItem -LiteralPath $readerResolvedCache -Recurse -Force | Where-Object { $_.PSIsContainer -and $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw '缓存含目录链接，不清理' }
    Remove-Item -LiteralPath $readerResolvedCache -Recurse
  }
  Write-Output '已清理默认编译／测试缓存，程序和阅读数据不受影响。'
  exit 0
}
if ($Action -eq 'Run') {
  $readerExecutable = Join-Path $readerRoot 'AnimeRead.exe'
  if (-not (Test-Path -LiteralPath $readerExecutable)) { throw '尚未生成程序，请运行 reader.ps1 -Action Build。' }
  if ($Book) { & $readerExecutable --open $Book } else { & $readerExecutable }
  exit 0
}
$readerNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $readerNode) { throw '需要 Node.js 22.13 或更高版本。' }
$readerCache = if ($env:ANIMEREAD_CACHE_DIR) { [IO.Path]::GetFullPath($env:ANIMEREAD_CACHE_DIR) } else { Join-Path $env:LOCALAPPDATA 'AnimeRead\build-cache' }
$env:ANIMEREAD_CACHE_DIR = $readerCache
$readerToolsRoot = if ($ToolsDir) { [IO.Path]::GetFullPath($ToolsDir) } elseif ($env:ANIMEREAD_TOOLS_DIR) { [IO.Path]::GetFullPath($env:ANIMEREAD_TOOLS_DIR) } else { Join-Path $readerCache 'tools' }
$env:ANIMEREAD_TOOLS_DIR = $readerToolsRoot
$readerPreference = if ($Action -eq 'CleanupTools') { 'System' } elseif ($Toolchain -eq 'Auto' -and $ToolsDir) { 'Local' } else { $Toolchain }
$readerLegacyTools = if (Test-Path -LiteralPath (Join-Path $readerRoot '.tools\cargo\bin\cargo.exe')) { Join-Path $readerRoot '.tools' } else { $readerToolsRoot }
$readerSelected = & (Join-Path $PSScriptRoot 'detect-toolchain.ps1') -LocalTools $readerLegacyTools -Preference $readerPreference
if ($Action -eq 'InspectTools') {
  $readerVerification = Join-Path $readerCache 'verification'
  New-Item -ItemType Directory -Path $readerVerification -Force | Out-Null
  $readerSelected | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $readerVerification 'toolchain-detection.json')
  $readerSelected | ConvertTo-Json
  exit 0
}
if ($readerSelected.kind -eq 'Missing' -and $Action -ne 'Run') {
  throw '未检测到可用工具链。请先按 docs/BUILD.md 安装 Microsoft C++ Build Tools 和 Rust MSVC；不会删除本地编译库。'
}
if ($readerSelected.kind -ne 'Missing') {
  $env:CARGO_HOME = $readerSelected.cargoHome
  $env:RUSTUP_HOME = $readerSelected.rustupHome
  $env:PATH = "$(Split-Path -Parent $readerSelected.cargo);$env:PATH"
  $env:RUSTUP_TOOLCHAIN = $readerSelected.toolchain
  $env:ANIMEREAD_BUILD_TARGET = $readerSelected.toolchain -replace '^stable-', ''
  if ($readerSelected.kind -eq 'Local') {
    $env:PATH = "$(Join-Path $readerSelected.cpp 'bin');$env:PATH"
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = $readerSelected.linker
  } else { Remove-Item Env:\CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER -ErrorAction SilentlyContinue }
}
$readerTarget = if ($TargetDir) { [IO.Path]::GetFullPath($TargetDir) } elseif ($env:CARGO_TARGET_DIR) { [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR) } else { Join-Path $readerCache $readerSelected.toolchain }
$env:CARGO_TARGET_DIR = $readerTarget
$env:CARGO_BUILD_JOBS = '6'
function Invoke-ReaderNode {
  param([string[]]$ReaderArguments)
  & $readerNode @ReaderArguments
  if ($LASTEXITCODE -ne 0) { throw "Node command failed ($LASTEXITCODE): $ReaderArguments" }
}
function Build-ReaderFrontend {
  Invoke-ReaderNode @('scripts/copy-pdf-assets.mjs')
  Invoke-ReaderNode @('node_modules/typescript/bin/tsc','--noEmit')
  Invoke-ReaderNode @('node_modules/vite/bin/vite.js','build')
}
function Build-ReaderPortable {
  Build-ReaderFrontend
  Invoke-ReaderNode @('scripts/tauri.mjs','build','--no-bundle')
  Invoke-ReaderNode @('scripts/package-portable.mjs')
}
switch ($Action) {
  'Check' { Build-ReaderFrontend; Invoke-ReaderNode @('scripts/cargo.mjs','check','--release','--locked','--manifest-path','src-tauri/Cargo.toml') }
  'Test' { Build-ReaderFrontend; Invoke-ReaderNode @('node_modules/vitest/vitest.mjs','run'); Invoke-ReaderNode @('node_modules/@playwright/test/cli.js','test') }
  'Dev' { Invoke-ReaderNode @('scripts/copy-pdf-assets.mjs'); Invoke-ReaderNode @('scripts/tauri.mjs','dev') }
  'Build' { Build-ReaderPortable }
  'Package' { Build-ReaderFrontend; Invoke-ReaderNode @('scripts/tauri.mjs','build'); Invoke-ReaderNode @('scripts/package-portable.mjs','--release'); Invoke-ReaderNode @('scripts/package-update.mjs') }
  'CleanupTools' {
    # The system compiler must complete a real release build before deletion.
    Build-ReaderPortable
    $readerLocalRoot = Join-Path $readerRoot '.tools'
    if (Test-Path -LiteralPath $readerLocalRoot) {
      $readerResolved = (Resolve-Path -LiteralPath $readerLocalRoot).Path
      if ($readerResolved -ne [IO.Path]::GetFullPath($readerLocalRoot)) { throw '工具清理目标异常' }
      if ((Get-Item -LiteralPath $readerResolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '工具目录是链接，不清理' }
      $readerLinks = @(Get-ChildItem -LiteralPath $readerResolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
      foreach ($readerLink in $readerLinks) {
        $readerProxyTarget = Join-Path $readerLink.DirectoryName 'rustup.exe'
        if ($readerLink.PSIsContainer -or $readerLink.LinkType -ne 'SymbolicLink' -or $readerLink.Target -ne 'rustup.exe' -or -not $readerProxyTarget.StartsWith($readerResolved + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $readerProxyTarget -PathType Leaf) -or ((Get-Item -LiteralPath $readerProxyTarget).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '工具目录包含非 Rustup 代理链接，不清理' }
      }
      # Remove validated proxy links themselves, never their targets.
      foreach ($readerLink in $readerLinks) { Remove-Item -LiteralPath $readerLink.FullName }
      foreach ($readerPart in @('cargo','rustup','gcc-mingw')) {
        $readerRemove = Join-Path $readerResolved $readerPart
        if (Test-Path -LiteralPath $readerRemove) { Remove-Item -LiteralPath $readerRemove -Recurse }
      }
      Write-Output '系统 MSVC 构建成功，项目内 Cargo/Rustup/MinGW 副本已删除；GPU 模型保留。'
    }
  }
}
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Command failed: $LASTEXITCODE" }
