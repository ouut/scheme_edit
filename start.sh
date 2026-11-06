#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PORT="${PORT:-3000}"
STATIC_DIR="$DIR/frontend/dist"

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

echo "Starting Scheme Editor on http://localhost:$PORT ..."
export PORT
export STATIC_DIR
exec "$DIR/server/target/release/server"
