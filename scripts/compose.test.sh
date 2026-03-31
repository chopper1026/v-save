#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"

assert_contains() {
  local actual="$1"
  local expected_part="$2"
  local message="$3"
  if [[ "$actual" != *"$expected_part"* ]]; then
    printf '断言失败：%s\n期望包含：%s\n实际：%s\n' "$message" "$expected_part" "$actual" >&2
    exit 1
  fi
}

main() {
  local compose_text
  compose_text="$(cat "$COMPOSE_FILE")"

  assert_contains "$compose_text" "/api/healthz" "backend healthcheck 应探测显式健康端点，避免把 /api 的 404 误判为健康"

  printf 'compose 测试通过。\n'
}

main "$@"
