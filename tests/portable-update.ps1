# 使用系统小程序验证真实 Windows 更新助手；不下载包，不接触读者档案。
$ErrorActionPreference = 'Stop'
$readerCache = if ($env:ANIMEREAD_CACHE_DIR) { $env:ANIMEREAD_CACHE_DIR } else { Join-Path $env:LOCALAPPDATA 'AnimeRead\build-cache' }
$readerQa = [IO.Path]::GetFullPath((Join-Path $readerCache ('updater-test-' + [guid]::NewGuid().ToString('N'))))
[IO.Directory]::CreateDirectory($readerQa) | Out-Null
$readerScript = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\src-tauri\windows\portable-update.ps1') -Raw -Encoding UTF8
$readerResults = @()
try {
  foreach ($readerCase in @('success', 'extended-path', 'rollback', 'whitelist', 'junction')) {
    $readerRoot = Join-Path (Join-Path $readerQa $readerCase) 'reader'
    $readerStage = Join-Path (Join-Path (Join-Path $readerQa $readerCase) 'updates') ([guid]::NewGuid().ToString('N'))
    $readerIncoming = Join-Path $readerStage 'incoming'
    [IO.Directory]::CreateDirectory($readerIncoming) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $readerRoot 'data')) | Out-Null
    Copy-Item -LiteralPath "$env:SystemRoot\System32\whoami.exe" -Destination (Join-Path $readerRoot 'AnimeRead.exe')
    Copy-Item -LiteralPath "$env:SystemRoot\System32\where.exe" -Destination (Join-Path $readerIncoming 'AnimeRead.exe')
    [IO.File]::WriteAllText((Join-Path $readerRoot 'data\library.json'), 'protected reading records')
    [IO.File]::WriteAllText((Join-Path $readerRoot 'portable.flag'), 'protected profile choice')
    $readerOldHash = (Get-FileHash -LiteralPath (Join-Path $readerRoot 'AnimeRead.exe')).Hash
    $readerNewHash = (Get-FileHash -LiteralPath (Join-Path $readerIncoming 'AnimeRead.exe')).Hash
    $readerFiles = @('AnimeRead.exe')
    if ($readerCase -eq 'rollback') { $readerFiles += 'runtime\missing.dll' }
    if ($readerCase -eq 'whitelist') { $readerFiles = @('data\library.json') }
    if ($readerCase -eq 'junction') {
      $readerOutside = Join-Path (Split-Path -Parent $readerRoot) 'outside'
      [IO.Directory]::CreateDirectory($readerOutside) | Out-Null
      [IO.File]::WriteAllText((Join-Path $readerOutside 'protected.txt'), 'protected link target')
      New-Item -ItemType Junction -Path (Join-Path $readerRoot 'runtime') -Target $readerOutside | Out-Null
      $readerFiles = @('runtime\protected.txt')
    }
    [IO.File]::WriteAllText((Join-Path $readerStage 'apply.ps1'), $readerScript, [Text.UTF8Encoding]::new($true))
    # 必须覆盖 Rust canonicalize 的真实输出，避免只测普通路径而遗漏发布故障。
    $readerRequestRoot = if ($readerCase -eq 'extended-path') { '\\?\' + $readerRoot } else { $readerRoot }
    $readerRequestStage = if ($readerCase -eq 'extended-path') { '\\?\' + $readerStage } else { $readerStage }
    $readerRequest = @{root=$readerRequestRoot;stage=$readerRequestStage;executable='AnimeRead.exe';pid=2147483647;files=$readerFiles}
    [IO.File]::WriteAllText((Join-Path $readerStage 'request.json'), ($readerRequest | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $readerChild = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $readerStage 'apply.ps1') + '"')) -WindowStyle Hidden -Wait -PassThru
    if ($readerChild.ExitCode -ne 0) { throw "Update helper failed: $readerCase" }
    $readerOutcome = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $readerStage) 'last-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $readerShouldSucceed = $readerCase -in @('success', 'extended-path')
    if ($readerOutcome.success -ne $readerShouldSucceed) { throw "Unexpected result: $readerCase" }
    $readerHash = (Get-FileHash -LiteralPath (Join-Path $readerRoot 'AnimeRead.exe')).Hash
    $readerExpected = if ($readerShouldSucceed) { $readerNewHash } else { $readerOldHash }
    if ($readerHash -ne $readerExpected) { throw "Replacement or rollback failed: $readerCase" }
    if ([IO.File]::ReadAllText((Join-Path $readerRoot 'data\library.json')) -ne 'protected reading records') { throw 'Reading records changed' }
    if ([IO.File]::ReadAllText((Join-Path $readerRoot 'portable.flag')) -ne 'protected profile choice') { throw 'Profile flag changed' }
    if ($readerShouldSucceed -and (Test-Path -LiteralPath $readerStage)) { throw 'Successful update left its stage' }
    if ($readerCase -eq 'junction') {
      if ([IO.File]::ReadAllText((Join-Path $readerOutside 'protected.txt')) -ne 'protected link target') { throw 'Link target changed' }
      # Windows PowerShell 某些系统版本的 Remove-Item 无法删除 junction。
      # 非递归 Directory.Delete 只删除已确认的测试链接本身，不跟随目标。
      $readerLink = [IO.Path]::GetFullPath((Join-Path $readerRoot 'runtime'))
      if (-not $readerLink.StartsWith($readerQa + '\', [StringComparison]::OrdinalIgnoreCase) -or -not ((Get-Item -LiteralPath $readerLink).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected test link' }
      [IO.Directory]::Delete($readerLink)
      if ([IO.File]::ReadAllText((Join-Path $readerOutside 'protected.txt')) -ne 'protected link target') { throw 'Link cleanup changed its target' }
    }
    $readerResults += @{case=$readerCase;passed=$true;dataPreserved=$true}
    Write-Output "PASS $readerCase"
  }
  $readerResults | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $readerCache 'portable-update-tests.json') -Encoding UTF8
} finally {
  # 仅清理本次 UUID 子目录；失败时若仍存在链接，保留目录供检查。
  $readerBoundary = [IO.Path]::GetFullPath($readerCache).TrimEnd('\') + '\'
  $readerLinks = @(Get-ChildItem -LiteralPath $readerQa -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if ($readerQa.StartsWith($readerBoundary, [StringComparison]::OrdinalIgnoreCase) -and $readerLinks.Count -eq 0 -and -not ((Get-Item -LiteralPath $readerQa).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-Item -LiteralPath $readerQa -Recurse }
}
