#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

BUILD_ONLY=false
FORCE_BUILD=false

for arg in "$@"; do
    case "$arg" in
        --build-only)
            BUILD_ONLY=true
            ;;
        --rebuild)
            FORCE_BUILD=true
            ;;
    esac
done

echo "=================================================="
echo "  Scheme Strict Paredit IDE - Build & Start"
echo "=================================================="

# 1. Ensure Node.js & npm exist
if ! command -v npm >/dev/null 2>&1; then
    echo "❌ 错误: 未检测到 npm，请先安装 Node.js (>= 18)"
    exit 1
fi

# 2. Ensure Cargo / Rust exists
if ! command -v cargo >/dev/null 2>&1; then
    echo "❌ 错误: 未检测到 cargo，请先安装 Rust (https://rustup.rs)"
    exit 1
fi

# 3. Build frontend if dist is missing, node_modules missing, or forced
if [ ! -d "$DIR/frontend/dist" ] || [ ! -f "$DIR/frontend/dist/index.html" ] || [ "$FORCE_BUILD" = true ]; then
    echo "📦 正在编译前端静态资源 (Vite + Monaco Editor)..."
    if [ ! -d "$DIR/frontend/node_modules" ]; then
        (cd "$DIR/frontend" && npm install)
    fi
    (cd "$DIR/frontend" && npm run build)
fi

# 4. Build Rust release binary if missing or forced or on build-only
TARGET_BIN="$DIR/server/target/release/scheme-ide"
ROOT_BIN="$DIR/scheme-ide"

if [ ! -f "$ROOT_BIN" ] || [ ! -f "$TARGET_BIN" ] || [ "$FORCE_BUILD" = true ] || [ "$BUILD_ONLY" = true ]; then
    echo "🦀 正在编译 Rust 独立单二进制包 (release profile)..."
    cargo build --release --manifest-path "$DIR/server/Cargo.toml"
    cp "$TARGET_BIN" "$ROOT_BIN.tmp"
    mv -f "$ROOT_BIN.tmp" "$ROOT_BIN"
    chmod +x "$ROOT_BIN"
    echo "✅ 本地二进制已生成: $ROOT_BIN"
fi

if [ "$BUILD_ONLY" = true ]; then
    echo "🎉 编译构建完成！可直接运行: ./scheme-ide"
    exit 0
fi

# 5. Clean up any stale running instances of scheme-ide
pkill -f "$ROOT_BIN" 2>/dev/null || true
sleep 0.2

# 6. Start the standalone binary
echo "🚀 启动 Scheme IDE 服务..."
exec "$ROOT_BIN" "$@"
