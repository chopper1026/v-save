#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DOCKERFILE="${REPO_ROOT}/backend/Dockerfile"

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
  local builder_block
  builder_block="$(awk '
    /FROM node:20-bookworm-slim AS builder/ { in_builder=1 }
    /FROM node:20-bookworm-slim AS runner/ { in_builder=0 }
    in_builder { print }
  ' "$BACKEND_DOCKERFILE")"

  assert_contains "$builder_block" "python3" "backend builder 阶段必须安装 python3，供 node-gyp 编译 sqlite3 使用"
  assert_contains "$builder_block" "make" "backend builder 阶段必须安装 make，供 node-gyp 编译 sqlite3 使用"
  assert_contains "$builder_block" "g++" "backend builder 阶段必须安装 g++，供 node-gyp 编译 sqlite3 使用"

  local runner_block
  runner_block="$(awk '
    /FROM node:20-bookworm-slim AS runner/ { in_runner=1 }
    in_runner { print }
  ' "$BACKEND_DOCKERFILE")"

  assert_contains "$runner_block" "python3" "backend runner 阶段必须安装 python3，供生产依赖安装时的 node-gyp 使用"
  assert_contains "$runner_block" "make" "backend runner 阶段必须安装 make，供生产依赖安装时的 node-gyp 使用"
  assert_contains "$runner_block" "g++" "backend runner 阶段必须安装 g++，供生产依赖安装时的 node-gyp 使用"

  printf 'dockerfile 测试通过。\n'
}

main "$@"
