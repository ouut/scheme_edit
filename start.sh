#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PORT="${PORT:-3000}"
STATIC_DIR="$DIR/frontend/dist"
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

echo "=================================================="
echo "  Scheme Strict Paredit Editor"
echo "  Port: $PORT"
echo "  Static Dir: $STATIC_DIR"
echo "=================================================="

# Check if release binary exists, else build it
if [ ! -f "$DIR/server/target/release/server" ]; then
    echo "Building Rust server (release profile)..."
    cd "$DIR/server"
    cargo build --release
fi

# Check if frontend/dist exists, else build it
if [ ! -f "$STATIC_DIR/index.html" ]; then
    echo "Building Frontend dist..."
    cd "$DIR/frontend"
    npm run build
fi

# If an older instance of the server is running on the same port, terminate it cleanly
pkill -f "$DIR/server/target/release/server" 2>/dev/null || true
sleep 0.5

echo "--------------------------------------------------"
echo "🚀 Scheme Editor 启动就绪！"
echo "   - 本机 / 端口转发访问:   http://localhost:$PORT"
if [ -n "$HOST_IP" ] && [ "$HOST_IP" != "127.0.0.1" ]; then
    echo "   - 宿主机 (Mac) 浏览器直连: http://$HOST_IP:$PORT"
fi
echo "--------------------------------------------------"
echo "💡 提示: 如果在 Mac 浏览器输入 localhost:$PORT 打不开:"
echo "   1. 请在 Mac 浏览器直接打开: http://${HOST_IP:-192.168.64.3}:$PORT"
echo "   2. 或者在 VS Code 底部「端口 (PORTS)」面板添加转发端口 3000"
echo "=================================================="

export PORT
export STATIC_DIR
exec "$DIR/server/target/release/server"
