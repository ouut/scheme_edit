# Fetch precompiled Windows x86_64 binaries for Scheme IDE's bundled Unix environment (Pure Scheme 2):
#   1. uutils/coreutils (coreutils.exe multicall binary: ls, cat, cp, mv, rm, mkdir, touch, head, tail, wc, etc.)
#   2. uutils/findutils (find.exe, xargs.exe)
#   3. BurntSushi/ripgrep (rg.exe -> mapped to rg.exe & grep.exe)
#   4. busybox-w32 (busybox64.exe -> mapped to POSIX sh.exe + sed, awk, tar, diff, clear, etc.)

param(
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "bin\windows"),
    [string]$CoreutilsVersion = "0.12.0",
    [string]$FindutilsVersion = "0.11.0",
    [string]$RipgrepVersion = "15.2.0",
    [string]$BusyboxUrl = "https://frippery.org/files/busybox/busybox64.exe"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("scheme-ide-fetch-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

function Extract-SingleFileFromZip {
    param(
        [string]$ZipPath,
        [string]$FileName,
        [string]$DestPath
    )
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entry = $archive.Entries | Where-Object { $_.Name -ieq $FileName } | Select-Object -First 1
        if (-not $entry) {
            throw "Entry '$FileName' not found inside '$ZipPath'"
        }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $DestPath, $true)
    } finally {
        $archive.Dispose()
    }
}

try {
    Write-Host "==> Downloading precompiled Windows x86_64 tools into: $OutDir" -ForegroundColor Cyan

    # 1. uutils/coreutils
    $CoreZip = Join-Path $TmpDir "coreutils.zip"
    $CoreUrl = "https://github.com/uutils/coreutils/releases/download/$CoreutilsVersion/coreutils-$CoreutilsVersion-x86_64-pc-windows-msvc.zip"
    Write-Host "  [1/4] Fetching uutils/coreutils v$CoreutilsVersion..."
    Invoke-WebRequest -Uri $CoreUrl -OutFile $CoreZip
    Extract-SingleFileFromZip -ZipPath $CoreZip -FileName "coreutils.exe" -DestPath (Join-Path $OutDir "coreutils.exe")

    # 2. uutils/findutils
    $FindZip = Join-Path $TmpDir "findutils.zip"
    $FindUrl = "https://github.com/uutils/findutils/releases/download/$FindutilsVersion/findutils-x86_64-pc-windows-msvc.zip"
    Write-Host "  [2/4] Fetching uutils/findutils v$FindutilsVersion..."
    Invoke-WebRequest -Uri $FindUrl -OutFile $FindZip
    Extract-SingleFileFromZip -ZipPath $FindZip -FileName "find.exe" -DestPath (Join-Path $OutDir "find.exe")
    Extract-SingleFileFromZip -ZipPath $FindZip -FileName "xargs.exe" -DestPath (Join-Path $OutDir "xargs.exe")

    # 3. ripgrep
    $RgZip = Join-Path $TmpDir "ripgrep.zip"
    $RgUrl = "https://github.com/BurntSushi/ripgrep/releases/download/$RipgrepVersion/ripgrep-$RipgrepVersion-x86_64-pc-windows-msvc.zip"
    Write-Host "  [3/4] Fetching ripgrep v$RipgrepVersion..."
    Invoke-WebRequest -Uri $RgUrl -OutFile $RgZip
    Extract-SingleFileFromZip -ZipPath $RgZip -FileName "rg.exe" -DestPath (Join-Path $OutDir "rg.exe")

    # 4. busybox-w32
    Write-Host "  [4/4] Fetching busybox-w32 (busybox64.exe)..."
    Invoke-WebRequest -Uri $BusyboxUrl -OutFile (Join-Path $OutDir "busybox64.exe")

    Write-Host "==> Done! Binaries in ${OutDir}:" -ForegroundColor Green
    Get-ChildItem $OutDir | Select-Object Name, Length
} finally {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
