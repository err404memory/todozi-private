#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DST_DIR="/home/ash/storage/service-wing/engine-room/todozi-manage"

rsync -av \
  --exclude 'deploy/todozi-manage.env' \
  "$SRC_DIR/" \
  "nova:$DST_DIR/"
