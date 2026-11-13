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

COREUTILS_VERSION="${COREUTILS_VERSION:-0.12.0}"
FINDUTILS_VERSION="${FINDUTILS_VERSION:-0.11.0}"
RIPGREP_VERSION="${RIPGREP_VERSION:-15.2.0}"
BUSYBOX_URL="${BUSYBOX_URL:-https://frippery.org/files/busybox/busybox64.exe}"

echo "==> Downloading precompiled Windows x86_64 tools into: $OUT_DIR"

extract_from_zip() {
    local zip_path="$1"
    local file_name="$2"
    local dest_path="$3"
    python3 - "$zip_path" "$file_name" "$dest_path" << 'PYEOF'
import sys, zipfile, os, shutil
zip_path, target_name, dest_path = sys.argv[1], sys.argv[2], sys.argv[3]
with zipfile.ZipFile(zip_path, 'r') as zf:
    for member in zf.namelist():
        if os.path.basename(member).lower() == target_name.lower():
            with zf.open(member) as src, open(dest_path, 'wb') as dst:
                shutil.copyfileobj(src, dst)
            sys.exit(0)
print(f"ERROR: {target_name} not found in {zip_path}", file=sys.stderr)
sys.exit(1)
PYEOF
}

# 1. uutils/coreutils
COREUTILS_ZIP="coreutils-${COREUTILS_VERSION}-x86_64-pc-windows-msvc.zip"
COREUTILS_URL="https://github.com/uutils/coreutils/releases/download/${COREUTILS_VERSION}/${COREUTILS_ZIP}"
echo "  [1/4] Fetching uutils/coreutils v${COREUTILS_VERSION}..."
curl -fL "$COREUTILS_URL" -o "$TMP_DIR/$COREUTILS_ZIP"
extract_from_zip "$TMP_DIR/$COREUTILS_ZIP" "coreutils.exe" "$OUT_DIR/coreutils.exe"

# 2. uutils/findutils
FINDUTILS_ZIP="findutils-x86_64-pc-windows-msvc.zip"
FINDUTILS_URL="https://github.com/uutils/findutils/releases/download/${FINDUTILS_VERSION}/${FINDUTILS_ZIP}"
echo "  [2/4] Fetching uutils/findutils v${FINDUTILS_VERSION}..."
curl -fL "$FINDUTILS_URL" -o "$TMP_DIR/$FINDUTILS_ZIP"
extract_from_zip "$TMP_DIR/$FINDUTILS_ZIP" "find.exe" "$OUT_DIR/find.exe"
extract_from_zip "$TMP_DIR/$FINDUTILS_ZIP" "xargs.exe" "$OUT_DIR/xargs.exe"

# 3. ripgrep (rg.exe)
RG_ZIP="ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip"
RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${RG_ZIP}"
echo "  [3/4] Fetching ripgrep v${RIPGREP_VERSION}..."
curl -fL "$RG_URL" -o "$TMP_DIR/$RG_ZIP"
extract_from_zip "$TMP_DIR/$RG_ZIP" "rg.exe" "$OUT_DIR/rg.exe"

# 4. busybox-w32 (busybox64.exe for POSIX sh + sed/awk/tar/diff/clear)
echo "  [4/4] Fetching busybox-w32 (busybox64.exe)..."
curl -fL "$BUSYBOX_URL" -o "$OUT_DIR/busybox64.exe"

echo "==> Done! Binaries in $OUT_DIR:"
ls -lh "$OUT_DIR"
