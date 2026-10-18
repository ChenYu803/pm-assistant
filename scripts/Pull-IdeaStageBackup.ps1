param(
    [Parameter(Mandatory = $true)][string]$SshTarget,
    [string]$RemoteDirectory = '/var/backups/ideastage',
    [string]$Destination = 'D:\Backups\IdeaStage',
    [int]$MaximumAgeHours = 30
)
$ErrorActionPreference = 'Stop'
if ($SshTarget -notmatch '^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$' -or $RemoteDirectory -notmatch '^/[A-Za-z0-9_./-]+$' -or $RemoteDirectory.Contains('..')) {
    throw 'SSH 目标或远程目录格式不合法。'
}
if ($MaximumAgeHours -lt 1) { throw 'MaximumAgeHours 必须大于 0。' }
$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$tempPath = Join-Path $destinationPath ('pull-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempPath | Out-Null
try {
    # SSH 密钥与已核对的 known_hosts 由用户部署时配置；不关闭主机密钥检查。
    & scp -o BatchMode=yes -o StrictHostKeyChecking=yes "${SshTarget}:${RemoteDirectory}/latest.json" (Join-Path $tempPath 'latest.json')
    if ($LASTEXITCODE -ne 0) { throw '无法获取服务器备份成功标志，请检查 SSH 与备份任务日志。' }
    $latest = Get-Content -LiteralPath (Join-Path $tempPath 'latest.json') -Raw | ConvertFrom-Json
    if ($latest.name -notmatch '^[0-9TZ-]+-[a-f0-9]{8}\.isb$' -or $latest.sha256 -notmatch '^[a-f0-9]{64}$') { throw '备份索引格式不合法。' }
    $created = [datetimeoffset]::Parse($latest.createdAt)
    $age = ([datetimeoffset]::UtcNow - $created).TotalHours
    if ($age -gt $MaximumAgeHours -or $age -lt -1) { throw '服务器备份已过期或时间异常；请检查定时任务。' }
    $candidate = Join-Path $tempPath $latest.name
    & scp -o BatchMode=yes -o StrictHostKeyChecking=yes "${SshTarget}:${RemoteDirectory}/$($latest.name)" $candidate
    if ($LASTEXITCODE -ne 0) { throw '备份下载失败，本地成功标志未更新。' }
    $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $latest.sha256) { throw '备份校验失败，本地成功标志未更新。' }
    $finalPath = Join-Path $destinationPath $latest.name
    if (Test-Path -LiteralPath $finalPath) {
        if ((Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $actual) { throw '同名本地备份内容不同，未覆盖。' }
    } else { Move-Item -LiteralPath $candidate -Destination $finalPath }
    Set-Content -LiteralPath ($finalPath + '.sha256') -Value ($actual + '  ' + $latest.name) -Encoding ascii
    $receipt = @{ name = $latest.name; sha256 = $actual; serverCreatedAt = $latest.createdAt; pulledAt = [datetimeoffset]::UtcNow.ToString('o') } | ConvertTo-Json
    $receipt | Set-Content -LiteralPath (Join-Path $tempPath 'last-pull.json') -Encoding utf8
    Move-Item -LiteralPath (Join-Path $tempPath 'last-pull.json') -Destination (Join-Path $destinationPath 'last-pull.json') -Force
    Write-Output "✅ 已拉取并校验 $($latest.name)。每周及重要更新后将 .isb 与 .sha256 上传百度网盘；密钥独立保管。"
} finally {
    # 递归删除前检查绝对路径，只清理本次直属随机目录。
    $resolvedTemp = [IO.Path]::GetFullPath($tempPath)
    if ([IO.Path]::GetDirectoryName($resolvedTemp) -ne $destinationPath -or [IO.Path]::GetFileName($resolvedTemp) -notmatch '^pull-[a-f0-9]{32}$') { throw '临时目录清理边界错误。' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
