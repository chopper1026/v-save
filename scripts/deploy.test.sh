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

  USE_CN_MIRROR=1
  assert_eq \
    "$(get_docker_install_script_url)" \
    "https://raw.githubusercontent.com/docker/docker-install/master/install.sh" \
    "中国大陆环境应优先使用官方 GitHub 源下载 Docker 安装脚本"
  assert_eq \
    "$(get_docker_install_mirror_flag)" \
    "AzureChinaCloud" \
    "中国大陆环境应默认启用 Docker 官方支持的 AzureChinaCloud 安装镜像"

  USE_CN_MIRROR=0
  assert_eq \
    "$(get_docker_install_script_url)" \
    "https://get.docker.com" \
    "全球网络环境应继续使用 get.docker.com 下载 Docker 安装脚本"
  assert_eq \
    "$(get_docker_install_mirror_flag)" \
    "" \
    "全球网络环境不应附带 Docker 安装镜像参数"

  USE_CN_MIRROR=1
  V_SAVE_DOCKER_INSTALL_SCRIPT_URL_CN="https://mirror.example.com/docker-install.sh"
  V_SAVE_DOCKER_INSTALL_MIRROR_CN="Aliyun"
  assert_eq \
    "$(get_docker_install_script_url)" \
    "https://mirror.example.com/docker-install.sh" \
    "应支持覆盖中国大陆环境下的 Docker 安装脚本地址"
  assert_eq \
    "$(get_docker_install_mirror_flag)" \
    "Aliyun" \
    "应支持覆盖中国大陆环境下的 Docker 安装镜像参数"
  unset V_SAVE_DOCKER_INSTALL_SCRIPT_URL_CN
  unset V_SAVE_DOCKER_INSTALL_MIRROR_CN

  PROJECT_NAME="V-SAVE"
  WEB_PUBLIC_ORIGIN="http://demo.example.com"
  PUBLIC_API_ORIGIN="http://demo.example.com/api"
  MYSQL_PORT="3306"
  MYSQL_DATABASE="v_save"
  MYSQL_USER="vsave_user"
  MYSQL_PASSWORD="app-secret"
  MYSQL_ROOT_PASSWORD="root-secret"
  REPO_DIR="/tmp/v-save"
  query_user_count() {
    printf '0\n'
  }

  local summary
  summary="$(show_summary)"
  assert_contains "$summary" "前端访问地址：http://demo.example.com" "部署摘要应保留访问地址"
  assert_contains "$summary" "配置文件位置：/tmp/v-save/.env" "部署摘要应保留配置文件位置"
  assert_contains "$summary" "数据库密码：app-secret" "部署摘要应显示应用数据库密码"
  assert_contains "$summary" "数据库 Root 密码：root-secret" "部署摘要应显示 Root 密码"

  printf 'deploy.sh 测试通过。\n'
}

main "$@"
