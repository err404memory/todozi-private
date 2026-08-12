#!/usr/bin/env bash
set -euo pipefail

export MANAGE_HOST="${MANAGE_HOST:-100.115.124.101}"
export MANAGE_PORT="${MANAGE_PORT:-3044}"
export TODOZI_BASE_URL="${TODOZI_BASE_URL:-http://100.115.124.101:8636}"
export TODOZI_BASE="${TODOZI_BASE:-$TODOZI_BASE_URL}"
export TODOZI_TIMEOUT_SECONDS="${TODOZI_TIMEOUT_SECONDS:-20}"

eval "$(
  python3 - <<'PY'
from __future__ import annotations

import json
import shlex
from pathlib import Path

key_path = Path.home() / ".todozi" / "api" / "api_keys.json"
raw = json.loads(key_path.read_text())
keys = raw.get("keys", {}) if isinstance(raw, dict) else {}

for item in keys.values():
    if not isinstance(item, dict) or not item.get("active", True):
        continue

    public_key = str(item.get("public_key") or "").strip()
    private_key = str(item.get("private_key") or "").strip()
    if public_key and private_key:
        print(f"export TODOZI_READ_KEY={shlex.quote(public_key)}")
        print(f"export TODOZI_ADMIN_KEY={shlex.quote(private_key)}")
        raise SystemExit(0)

raise SystemExit(f"No active Todozi API key pair found in {key_path}")
PY
)"

exec /usr/bin/env node /home/ash/storage/service-wing/engine-room/todozi-manage/server.js
