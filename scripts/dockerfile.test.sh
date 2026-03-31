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
  local builder_block
  builder_block="$(awk '
    /FROM node:20-bookworm-slim AS builder/ { in_builder=1 }
    /FROM node:20-bookworm-slim AS runner/ { in_builder=0 }
    in_builder { print }
  ' "$BACKEND_DOCKERFILE")"

  assert_contains "$builder_block" "python3" "backend builder 阶段必须安装 python3，供 node-gyp 编译 sqlite3 使用"
  assert_contains "$builder_block" "make" "backend builder 阶段必须安装 make，供 node-gyp 编译 sqlite3 使用"
  assert_contains "$builder_block" "g++" "backend builder 阶段必须安装 g++，供 node-gyp 编译 sqlite3 使用"
  assert_contains "$builder_block" "python3-venv" "backend builder 阶段必须创建 Python venv，供 gmssl 运行"
  assert_contains "$builder_block" "npm prune --omit=dev" "backend builder 阶段必须裁剪 devDependencies，避免生产镜像二次安装"
  assert_contains "$builder_block" "npm cache clean --force" "backend builder 阶段必须清理 npm cache"
  assert_contains "$builder_block" "rm -rf /root/.npm" "backend builder 阶段必须删除 npm 缓存目录"
  assert_contains "$builder_block" "find dist -type f" "backend builder 阶段必须清理 dist 中无用的 map 和声明文件"

  local runner_block
  runner_block="$(awk '
    /FROM node:20-bookworm-slim AS runner/ { in_runner=1 }
    in_runner { print }
  ' "$BACKEND_DOCKERFILE")"

  assert_contains "$runner_block" "python3" "backend runner 阶段必须安装 python3，供 Douyin Python helper 运行"
  assert_contains "$runner_block" "ffmpeg" "backend runner 阶段必须保留 ffmpeg 运行时"
  assert_contains "$runner_block" "yt-dlp" "backend runner 阶段必须保留 yt-dlp 运行时"
  assert_contains "$runner_block" "chromium" "backend runner 阶段必须保留 Chromium，避免快手解析回归"
  assert_contains "$runner_block" "COPY --from=builder /app/node_modules ./node_modules" "backend runner 阶段必须复用 builder 裁剪后的生产依赖"
  assert_contains "$runner_block" "COPY --from=builder /opt/douyin-python /opt/douyin-python" "backend runner 阶段必须复用 builder 构建好的 Python venv"
  assert_contains "$runner_block" "CMD [\"node\", \"dist/main\"]" "backend runner 阶段必须直接运行构建产物，避免经由 npm 启动"
  assert_not_contains "$runner_block" "npm ci --omit=dev" "backend runner 阶段不应再次安装生产依赖"
  assert_not_contains "$runner_block" "make" "backend runner 阶段不应保留 make"
  assert_not_contains "$runner_block" "g++" "backend runner 阶段不应保留 g++"
  assert_not_contains "$runner_block" "python3-venv" "backend runner 阶段不应保留 python3-venv"
  assert_not_contains "$runner_block" "curl" "backend runner 阶段不应保留未使用的 curl"

  printf 'dockerfile 测试通过。\n'
}

main "$@"
