@echo off
setlocal enabledelayedexpansion

set "DIR=%~dp0"
cd /d "%DIR%"

echo ==================================================
echo   Scheme Strict Paredit IDE - Build ^& Start (Windows)
echo ==================================================

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] 未检测到 npm，请先安装 Node.js (>= 18)
    exit /b 1
)

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] 未检测到 cargo，请先安装 Rust (https://rustup.rs)
    exit /b 1
)

if not exist "%DIR%frontend\dist\index.html" (
    echo [1/3] 正在编译前端静态资源 (Vite + Monaco Editor)...
    if not exist "%DIR%frontend\node_modules" (
        cd /d "%DIR%frontend" && npm install && cd /d "%DIR%"
    )
    cd /d "%DIR%frontend" && npm run build && cd /d "%DIR%"
)

set "TARGET_BIN=%DIR%server\target\release\scheme-ide.exe"
set "ROOT_BIN=%DIR%scheme-ide.exe"

if not exist "%ROOT_BIN%" (
    echo [2/3] 正在编译 Rust 独立单二进制包 (release profile)...
    cargo build --release --manifest-path "%DIR%server\Cargo.toml"
    copy /y "%TARGET_BIN%" "%ROOT_BIN%" >nul
    echo [OK] 本地二进制已生成: %ROOT_BIN%
)

if "%1"=="--build-only" (
    echo [OK] 编译构建完成！可直接运行: .\scheme-ide.exe
    exit /b 0
)

echo [3/3] 启动 Scheme IDE 服务...
"%ROOT_BIN%" %*
