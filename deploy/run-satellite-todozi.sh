#!/usr/bin/env bash
set -euo pipefail

TODOZI_HOST="${TODOZI_HOST:-100.115.124.101}"
TODOZI_PORT="${TODOZI_PORT:-8636}"
TODOZI_BIN="${TODOZI_BIN:-/home/ash/storage/unit/cargo/bin/todozi}"
TODOZI_BASE_URL="${TODOZI_BASE_URL:-http://${TODOZI_HOST}:${TODOZI_PORT}}"

todozi_http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "${TODOZI_BASE_URL}/api/health" 2>/dev/null || true
}

todozi_is_answering() {
  local code
  code="$(todozi_http_code)"
  [[ "${code}" == "200" || "${code}" == "401" ]]
}

while todozi_is_answering; do
  echo "Existing Todozi API detected at ${TODOZI_BASE_URL}; waiting for it to exit before starting managed backend."

  while todozi_is_answering; do
    sleep 5
  done

  echo "Existing Todozi API at ${TODOZI_BASE_URL} disappeared; starting managed backend."
done

exec "${TODOZI_BIN}" server start --host "${TODOZI_HOST}" --port "${TODOZI_PORT}"
