#!/bin/bash
# ECS Linux 客户端验证（跨平台同步）：加入 vault → 拉取 → 写入 → 推送
set -e
export CAIRN_HOME=/root/cairn-e2e-home
export CAIRN_SYNCD_TOKEN="$1"
export PATH=/opt/node22/bin:/usr/local/bin:$PATH
cd /opt/cairn-e2e
CLI() { timeout 60 node node_modules/@cairn/memory/dist/src/interfaces/cli/main.js --home /root/cairn-e2e-home --json "$@"; echo "[exit $?] $*" >&2; }
CLI init
CLI vault import-key --recovery-file /tmp/syncd-recovery.txt
CLI vault init-remote --provider syncd --base-url http://100.65.135.122:8471
echo "-- pull (restore Windows memories) --"
CLI sync pull
CLI search 'Windows 端写入'
echo "-- write on Linux and push --"
CLI add 'Linux ECS 端写入：跨平台验证'
CLI sync push
echo ECS_FLOW_DONE
