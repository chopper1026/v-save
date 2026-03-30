#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V_SAVE_DEPLOY_SOURCE_ONLY=1 source "${SCRIPT_DIR}/deploy.sh"

assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    printf '断言失败：%s\n期望：%s\n实际：%s\n' "$message" "$expected" "$actual" >&2
    exit 1
  fi
}

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
  assert_eq "$(normalize_arch x86_64)" "amd64" "x86_64 应映射到 amd64"
  assert_eq "$(normalize_arch aarch64)" "arm64" "aarch64 应映射到 arm64"
  assert_eq "$(normalize_arch armv7l)" "armv7" "armv7l 应映射到 armv7"

  assert_eq "$(build_http_origin 1.2.3.4 80)" "http://1.2.3.4" "80 端口应省略显示"
  assert_eq "$(build_http_origin example.com 4871)" "http://example.com:4871" "非 80 端口应保留"

  local cors
  cors="$(build_cors_origins 8.8.8.8 8080)"
  assert_contains "$cors" "http://8.8.8.8:8080" "CORS 列表应包含外部访问地址"
  assert_contains "$cors" "http://localhost:8080" "CORS 列表应包含本地调试地址"

  if ! is_yes_answer ""; then
    printf '断言失败：空输入应视为确认。\n' >&2
    exit 1
  fi
  if ! is_yes_answer "Y"; then
    printf '断言失败：Y 应视为确认。\n' >&2
    exit 1
  fi
  if is_yes_answer "n"; then
    printf '断言失败：n 不应视为确认。\n' >&2
    exit 1
  fi

  printf 'deploy.sh 测试通过。\n'
}

main "$@"
