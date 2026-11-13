#!/usr/bin/env bash
# Fetch precompiled Windows x86_64 binaries for Scheme IDE's bundled Unix environment (Pure Scheme 2):
#   1. uutils/coreutils (coreutils.exe multicall binary: ls, cat, cp, mv, rm, mkdir, touch, head, tail, wc, etc.)
#   2. uutils/findutils (find.exe, xargs.exe)
#   3. BurntSushi/ripgrep (rg.exe -> mapped to rg.exe & grep.exe)
#   4. busybox-w32 (busybox64.exe -> mapped to POSIX sh.exe + sed, awk, tar, diff, clear, etc.)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/bin/windows}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$OUT_DIR"

COREUTILS_VERSION="${COREUTILS_VERSION:-0.0.29}"
FINDUTILS_VERSION="${FINDUTILS_VERSION:-0.7.0}"
RIPGREP_VERSION="${RIPGREP_VERSION:-14.1.1}"
BUSYBOX_URL="${BUSYBOX_URL:-https://frippery.org/files/busybox/busybox64.exe}"

echo "==> Downloading precompiled Windows x86_64 tools into: $OUT_DIR"

# 1. uutils/coreutils
COREUTILS_ZIP="coreutils-${COREUTILS_VERSION}-x86_64-pc-windows-msvc.zip"
COREUTILS_URL="https://github.com/uutils/coreutils/releases/download/${COREUTILS_VERSION}/${COREUTILS_ZIP}"
echo "  [1/4] Fetching uutils/coreutils v${COREUTILS_VERSION}..."
curl -fL "$COREUTILS_URL" -o "$TMP_DIR/$COREUTILS_ZIP"
unzip -q "$TMP_DIR/$COREUTILS_ZIP" -d "$TMP_DIR/coreutils"
find "$TMP_DIR/coreutils" -name "coreutils.exe" -exec cp -f {} "$OUT_DIR/coreutils.exe" \;

# 2. uutils/findutils
FINDUTILS_ZIP="findutils-${FINDUTILS_VERSION}-x86_64-pc-windows-msvc.zip"
FINDUTILS_URL="https://github.com/uutils/findutils/releases/download/${FINDUTILS_VERSION}/${FINDUTILS_ZIP}"
echo "  [2/4] Fetching uutils/findutils v${FINDUTILS_VERSION}..."
if curl -fL "$FINDUTILS_URL" -o "$TMP_DIR/$FINDUTILS_ZIP" 2>/dev/null; then
    unzip -q "$TMP_DIR/$FINDUTILS_ZIP" -d "$TMP_DIR/findutils"
    find "$TMP_DIR/findutils" -name "find.exe" -exec cp -f {} "$OUT_DIR/find.exe" \;
    find "$TMP_DIR/findutils" -name "xargs.exe" -exec cp -f {} "$OUT_DIR/xargs.exe" \;
else
    echo "    (findutils zip fallback: busybox64.exe will provide find & xargs)"
fi

# 3. ripgrep (rg.exe)
RG_ZIP="ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip"
RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${RG_ZIP}"
echo "  [3/4] Fetching ripgrep v${RIPGREP_VERSION}..."
curl -fL "$RG_URL" -o "$TMP_DIR/$RG_ZIP"
unzip -q "$TMP_DIR/$RG_ZIP" -d "$TMP_DIR/ripgrep"
find "$TMP_DIR/ripgrep" -name "rg.exe" -exec cp -f {} "$OUT_DIR/rg.exe" \;

# 4. busybox-w32 (busybox64.exe for POSIX sh + sed/awk/tar/diff/clear)
echo "  [4/4] Fetching busybox-w32 (busybox64.exe)..."
curl -fL "$BUSYBOX_URL" -o "$OUT_DIR/busybox64.exe"

echo "==> Done! Binaries in $OUT_DIR:"
ls -lh "$OUT_DIR"
