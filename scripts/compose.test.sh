#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
RELEASE_COMPOSE_FILE="${REPO_ROOT}/docker-compose.release.yml"

assert_contains() {
  local actual="$1"
  local expected_part="$2"
  local message="$3"
  if [[ "$actual" != *"$expected_part"* ]]; then
    printf '断言失败：%s\n期望包含：%s\n实际：%s\n' "$message" "$expected_part" "$actual" >&2
    exit 1
  fi
}

assert_not_contains() {
  local actual="$1"
  local unexpected_part="$2"
  local message="$3"
  if [[ "$actual" == *"$unexpected_part"* ]]; then
    printf '断言失败：%s\n不应包含：%s\n实际：%s\n' "$message" "$unexpected_part" "$actual" >&2
    exit 1
  fi
}

main() {
  local compose_text
  compose_text="$(cat "$COMPOSE_FILE")"

  assert_contains "$compose_text" "/api/healthz" "backend healthcheck 应探测显式健康端点，避免把 /api 的 404 误判为健康"

  local release_compose_text
  release_compose_text="$(cat "$RELEASE_COMPOSE_FILE")"

  assert_contains "$release_compose_text" 'image: ${V_SAVE_BACKEND_IMAGE}:${V_SAVE_IMAGE_TAG}' "生产 compose 应通过镜像名和 tag 拉起后端"
  assert_contains "$release_compose_text" 'image: ${V_SAVE_FRONTEND_IMAGE}:${V_SAVE_IMAGE_TAG}' "生产 compose 应通过镜像名和 tag 拉起前端"
  assert_contains "$release_compose_text" "/api/healthz" "生产 compose 的 backend healthcheck 应保留显式健康探测"
  assert_not_contains "$release_compose_text" "build:" "生产 compose 不应再要求服务器本地构建镜像"

  printf 'compose 测试通过。\n'
}

main "$@"
