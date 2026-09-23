# deploy-to-github.ps1 — 一键推送 GitHub（PowerShell 版）
# 用法：在项目根目录执行 .\scripts\deploy-to-github.ps1
# 前提：已在 https://github.com/new 创建空仓库 minimal-epub-md-reader

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoUrl = "git@github.com:kuyan-007/minimal-epub-md-reader.git"

# 切到脚本所在目录的上两级（项目根）
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

Write-Host "==> 项目根: $projectRoot" -ForegroundColor Cyan
Write-Host "==> 当前分支: $(git branch --show-current)" -ForegroundColor Cyan
Write-Host "==> 远程仓库: $repoUrl" -ForegroundColor Cyan
Write-Host ""

# 1) 探测远程是否已配置
$existing = git remote get-url origin 2>$null
if (-not $existing) {
    Write-Host "==> 添加远程 origin" -ForegroundColor Yellow
    git remote add origin $repoUrl
} else {
    Write-Host "==> 远程已配置: $existing" -ForegroundColor Gray
}

# 2) 探测仓库是否存在
Write-Host "==> 探测 GitHub 仓库是否就绪（请确保已在 https://github.com/new 创建空仓库）..." -ForegroundColor Yellow
git ls-remote origin 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ 仓库尚不可达。请先在 GitHub 创建空仓库：" -ForegroundColor Red
    Write-Host "   https://github.com/new?repo_name=minimal-epub-md-reader" -ForegroundColor Red
    Write-Host ""
    Write-Host "创建后再次执行此脚本。" -ForegroundColor Yellow
    exit 1
}

# 3) 推送 main
Write-Host "==> 推送 main 分支..." -ForegroundColor Yellow
git push -u origin main
if ($LASTEXITCODE -ne 0) { exit 1 }

# 4) 创建并推送 v1.8.0 tag（触发 GitHub Actions 自动出 release）
Write-Host "==> 创建并推送 tag v1.8.0（触发 release 工作流）..." -ForegroundColor Yellow
git tag v1.8.0 2>$null
git push origin v1.8.0
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "✅ 推送完成！" -ForegroundColor Green
Write-Host ""
Write-Host "接下来你可以：" -ForegroundColor Cyan
Write-Host "  1. 打开 https://github.com/kuyan-007/minimal-epub-md-reader 查看" -ForegroundColor White
Write-Host "  2. 在 Actions 页查看 release 工作流: https://github.com/kuyan-007/minimal-epub-md-reader/actions" -ForegroundColor White
Write-Host "  3. 在 Settings → Pages 配置 README 徽章（可选）" -ForegroundColor White
