# 🚀 Auto Development & Deployment Script
# Chạy lệnh này để bắt đầu development với auto-commit và deploy

param(
    [string]$Message = "",
    [switch]$FullStack = $false,
    [switch]$CommitOnly = $false,
    [switch]$DevOnly = $false
)

Write-Host "🚀 AgriIntel Auto Development & Deployment" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

# Chuyển đến thư mục project
Set-Location "c:\Users\Admin\Documents\GitHub\newprojeck"

if ($CommitOnly) {
    Write-Host "📝 Running auto-commit only..." -ForegroundColor Yellow
    npm run auto-commit
    exit
}

if ($DevOnly) {
    Write-Host "🔧 Starting development servers only..." -ForegroundColor Yellow
    if ($FullStack) {
        npm run dev:full
    } else {
        npm run dev
    }
    exit
}

# Kiểm tra và commit changes nếu có
Write-Host "🔍 Checking for uncommitted changes..." -ForegroundColor Cyan
$status = git status --porcelain
if ($status) {
    Write-Host "📝 Found changes, committing..." -ForegroundColor Yellow
    git add .
    
    if ($Message) {
        git commit -m $Message
    } else {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        git commit -m "Auto-commit: $timestamp"
    }
    
    Write-Host "✅ Changes committed and will auto-push!" -ForegroundColor Green
} else {
    Write-Host "✅ No changes to commit" -ForegroundColor Green
}

# Bắt đầu development servers
Write-Host "🏃‍♂️ Starting development servers..." -ForegroundColor Cyan

if ($FullStack) {
    Write-Host "🔄 Starting full-stack development (Frontend + Backend + ML Service)" -ForegroundColor Magenta
    npm run dev:full
} else {
    Write-Host "🔄 Starting frontend + backend development" -ForegroundColor Magenta
    npm run dev
}