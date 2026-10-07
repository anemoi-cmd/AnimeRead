# 仅由签名验证后的便携更新调用：先等旧进程退出，再替换白名单文件。
# 所有读写、回滚和清理仍在本脚本中完成，不跨 shell 拼接删除命令。
$ErrorActionPreference = 'Stop'
function Resolve-ReaderShellPath([string]$Path) {
  # Rust canonicalize 会返回 Windows 的扩展路径；PowerShell 5.1 的 Join-Path
  # 无法识别其驱动器。只转换前缀，不改变实际目录，保留 UNC 网络路径。
  if ($Path.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) { $Path = '\\' + $Path.Substring(8) }
  elseif ($Path.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) { $Path = $Path.Substring(4) }
  return [IO.Path]::GetFullPath($Path)
}
$readerStage = Resolve-ReaderShellPath $PSScriptRoot
$readerRequest = Get-Content -LiteralPath (Join-Path $readerStage 'request.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$readerRequest.stage = Resolve-ReaderShellPath $readerRequest.stage
$readerRoot = Resolve-ReaderShellPath $readerRequest.root
function Resolve-ReaderTarget([string]$Base, [string]$Relative) {
  $readerTarget = [IO.Path]::GetFullPath((Join-Path $Base $Relative))
  if (-not $readerTarget.StartsWith($Base.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '更新路径越界' }
  $readerAncestor = $readerTarget
  while ($readerAncestor -and $readerAncestor.StartsWith($Base, [StringComparison]::OrdinalIgnoreCase)) {
    if ((Test-Path -LiteralPath $readerAncestor) -and ((Get-Item -LiteralPath $readerAncestor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '更新目标不能是目录链接' }
    $readerAncestor = Split-Path -Parent $readerAncestor
  }
  return $readerTarget
}
$readerChanged = @()
$readerSuccess = $false
$readerError = ''
try {
  if ($readerRequest.stage -ne $readerStage -or ((Get-Item -LiteralPath $readerStage).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '暂存位置异常' }
  if (Get-Process -Id $readerRequest.pid -ErrorAction SilentlyContinue) { Wait-Process -Id $readerRequest.pid -Timeout 120 }
  foreach ($readerRelative in $readerRequest.files) {
    if ($readerRelative -ne $readerRequest.executable -and $readerRelative -ne 'WebView2Loader.dll' -and $readerRelative -notmatch '^runtime[\\/]') { throw '更新文件不在白名单中' }
    $readerTarget = Resolve-ReaderTarget $readerRoot $readerRelative
    $readerSource = Resolve-ReaderTarget (Join-Path $readerStage 'incoming') $readerRelative
    $readerBackup = Resolve-ReaderTarget (Join-Path $readerStage 'backup') $readerRelative
    $readerExisted = Test-Path -LiteralPath $readerTarget -PathType Leaf
    if ($readerExisted) {
      [IO.Directory]::CreateDirectory((Split-Path -Parent $readerBackup)) | Out-Null
      [IO.File]::Copy($readerTarget, $readerBackup, $false)
    }
    $readerChanged += [pscustomobject]@{Target=$readerTarget;Backup=$readerBackup;Existed=$readerExisted}
    [IO.Directory]::CreateDirectory((Split-Path -Parent $readerTarget)) | Out-Null
    [IO.File]::Copy($readerSource, $readerTarget, $true)
  }
  $readerSuccess = $true
} catch {
  $readerError = $_.Exception.Message
  [array]::Reverse($readerChanged)
  foreach ($readerChange in $readerChanged) {
    try {
      if ($readerChange.Existed) { [IO.File]::Copy($readerChange.Backup, $readerChange.Target, $true) }
      elseif (Test-Path -LiteralPath $readerChange.Target -PathType Leaf) { Remove-Item -LiteralPath $readerChange.Target }
    } catch { $readerError += '; 回滚失败：' + $_.Exception.Message }
  }
}
[pscustomobject]@{success=$readerSuccess;error=$readerError;time=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $readerStage) 'last-result.json') -Encoding UTF8
Start-Process -FilePath (Resolve-ReaderTarget $readerRoot $readerRequest.executable) -WorkingDirectory $readerRoot -WindowStyle Hidden
if ($readerSuccess) {
  # 删除仅包含本次程序副本的暂存目录。退出前已验证绝对路径和非链接属性。
  $readerLinks = @(Get-ChildItem -LiteralPath $readerStage -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if ($readerStage -eq $readerRequest.stage -and $readerLinks.Count -eq 0 -and -not ((Get-Item -LiteralPath $readerStage).Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-Item -LiteralPath $readerStage -Recurse }
}
