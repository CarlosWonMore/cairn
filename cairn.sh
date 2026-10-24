#!/bin/sh
# Cairn CLI 启动器（POSIX/Git Bash）：显式用 node 执行构建产物
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$DIR/dist/src/interfaces/cli/main.js" ]; then
  echo "[cairn] dist not found. Run: npm run build" >&2
  exit 1
fi
exec node "$DIR/dist/src/interfaces/cli/main.js" "$@"
