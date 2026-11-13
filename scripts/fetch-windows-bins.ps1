# Fetch precompiled Windows x86_64 binaries for Scheme IDE's bundled Unix environment (Pure Scheme 2):
#   1. uutils/coreutils (coreutils.exe multicall binary: ls, cat, cp, mv, rm, mkdir, touch, head, tail, wc, etc.)
#   2. uutils/findutils (find.exe, xargs.exe)
#   3. BurntSushi/ripgrep (rg.exe -> mapped to rg.exe & grep.exe)
#   4. busybox-w32 (busybox64.exe -> mapped to POSIX sh.exe + sed, awk, tar, diff, clear, etc.)

param(
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "bin\windows"),
    [string]$CoreutilsVersion = "0.0.29",
    [string]$FindutilsVersion = "0.7.0",
    [string]$RipgrepVersion = "14.1.1",
    [string]$BusyboxUrl = "https://frippery.org/files/busybox/busybox64.exe"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("scheme-ide-fetch-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

try {
    Write-Host "==> Downloading precompiled Windows x86_64 tools into: $OutDir" -ForegroundColor Cyan

    # 1. uutils/coreutils
    $CoreZip = Join-Path $TmpDir "coreutils.zip"
    $CoreUrl = "https://github.com/uutils/coreutils/releases/download/$CoreutilsVersion/coreutils-$CoreutilsVersion-x86_64-pc-windows-msvc.zip"
    Write-Host "  [1/4] Fetching uutils/coreutils v$CoreutilsVersion..."
    Invoke-WebRequest -Uri $CoreUrl -OutFile $CoreZip
    Expand-Archive -Path $CoreZip -DestinationPath (Join-Path $TmpDir "coreutils") -Force
    $CoreExe = Get-ChildItem -Path (Join-Path $TmpDir "coreutils") -Filter "coreutils.exe" -Recurse | Select-Object -First 1
    Copy-Item $CoreExe.FullName -Destination (Join-Path $OutDir "coreutils.exe") -Force

    # 2. uutils/findutils
    $FindZip = Join-Path $TmpDir "findutils.zip"
    $FindUrl = "https://github.com/uutils/findutils/releases/download/$FindutilsVersion/findutils-$FindutilsVersion-x86_64-pc-windows-msvc.zip"
    Write-Host "  [2/4] Fetching uutils/findutils v$FindutilsVersion..."
    try {
        Invoke-WebRequest -Uri $FindUrl -OutFile $FindZip
        Expand-Archive -Path $FindZip -DestinationPath (Join-Path $TmpDir "findutils") -Force
        $FindExe = Get-ChildItem -Path (Join-Path $TmpDir "findutils") -Filter "find.exe" -Recurse | Select-Object -First 1
        if ($FindExe) { Copy-Item $FindExe.FullName -Destination (Join-Path $OutDir "find.exe") -Force }
        $XargsExe = Get-ChildItem -Path (Join-Path $TmpDir "findutils") -Filter "xargs.exe" -Recurse | Select-Object -First 1
        if ($XargsExe) { Copy-Item $XargsExe.FullName -Destination (Join-Path $OutDir "xargs.exe") -Force }
    } catch {
        Write-Host "    (findutils zip fallback: busybox64.exe will provide find & xargs)"
    }

    # 3. ripgrep
    $RgZip = Join-Path $TmpDir "ripgrep.zip"
    $RgUrl = "https://github.com/BurntSushi/ripgrep/releases/download/$RipgrepVersion/ripgrep-$RipgrepVersion-x86_64-pc-windows-msvc.zip"
    Write-Host "  [3/4] Fetching ripgrep v$RipgrepVersion..."
    Invoke-WebRequest -Uri $RgUrl -OutFile $RgZip
    Expand-Archive -Path $RgZip -DestinationPath (Join-Path $TmpDir "ripgrep") -Force
    $RgExe = Get-ChildItem -Path (Join-Path $TmpDir "ripgrep") -Filter "rg.exe" -Recurse | Select-Object -First 1
    Copy-Item $RgExe.FullName -Destination (Join-Path $OutDir "rg.exe") -Force

    # 4. busybox-w32
    Write-Host "  [4/4] Fetching busybox-w32 (busybox64.exe)..."
    Invoke-WebRequest -Uri $BusyboxUrl -OutFile (Join-Path $OutDir "busybox64.exe")

    Write-Host "==> Done! Binaries in ${OutDir}:" -ForegroundColor Green
    Get-ChildItem $OutDir | Select-Object Name, Length
} finally {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
