# 一键把 publish/ 推到你的 GitHub 公开仓库（Windows PowerShell）
# 用法：在 publish 目录下运行（或任意位置指定完整路径）：
#   powershell -ExecutionPolicy Bypass -File scripts\push-to-github.ps1 -Owner <你的GitHub用户名> -Author "<你的名字>"
# 说明：
#   - 会自动填占位符（README/package.json/LICENSE），提交、重打 v0.12.0 tag、加 origin 并 push
#   - 第一次 push 会弹出 Git Credential Manager 登录窗口：选 GitHub / 用你的 Google 账号登录一次即可
#   - 仓库需要先在 GitHub 建好：https://github.com/new （名字 emoking，Public，不要勾 README/gitignore/license）
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Author = $Owner,
  [string]$Repo = 'emoking'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $PSScriptRoot
Set-Location $here

if (-not (Test-Path 'package.json')) { throw '请在 publish 目录内运行（找不到 package.json）' }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Users\34767\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path $node)) { throw '找不到 node.exe' }

Write-Host "[1/6] 填占位符 owner=$Owner repo=$Repo ..." -ForegroundColor Cyan
& $node scripts/init-repo.mjs --owner $Owner --repo $Repo --author $Author

Write-Host "[2/6] 配置本仓库 git 身份 ..." -ForegroundColor Cyan
git config user.name $Author
git config user.email "$Owner@users.noreply.github.com"

Write-Host "[3/6] 提交元数据 ..." -ForegroundColor Cyan
git add -A
git commit -m "chore: 填好 GitHub 仓库元数据（$Owner/$Repo）" --allow-empty

Write-Host "[4/6] 重新打 v0.12.0 tag ..." -ForegroundColor Cyan
git tag -d v0.12.0 2>$null | Out-Null
git tag v0.12.0

Write-Host "[5/6] 设置 origin ..." -ForegroundColor Cyan
git remote remove origin 2>$null
git remote add origin "https://github.com/$Owner/$Repo.git"

Write-Host "[6/6] 推送 main + tag（会弹浏览器登录）..." -ForegroundColor Cyan
git push -u origin main
git push origin v0.12.0

Write-Host ""
Write-Host "完成！仓库地址：https://github.com/$Owner/$Repo" -ForegroundColor Green
Write-Host "接下来（各 1 分钟）：" -ForegroundColor Green
Write-Host "  1) 打开 https://github.com/$Owner/$Repo  右侧 About ⚙ → Topics 加：dsh-plugin deepseek-harness dsh widget simulation"
Write-Host "  2) 提交 Hub：https://dsh-plugin.org/zh/submit （用 HUB-SUBMISSION.md 里的字段，或直接提 Issue）"
Write-Host "  3) 可选：GitHub Releases 里用 tag v0.12.0 建 Release"
