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

  assert_eq \
    "$(get_docker_repo_root_url)" \
    "https://mirror.azure.cn/docker-ce/linux" \
    "中国大陆环境应使用 Docker 中国镜像仓库根地址"
  assert_eq \
    "$(get_docker_rpm_repo_url fedora)" \
    "https://mirror.azure.cn/docker-ce/linux/fedora/docker-ce.repo" \
    "Fedora 应使用 fedora RPM 仓库地址"
  assert_eq \
    "$(get_docker_rpm_repo_url rocky)" \
    "https://mirror.azure.cn/docker-ce/linux/centos/docker-ce.repo" \
    "RHEL 系发行版应默认复用 centos RPM 仓库地址"
  assert_eq \
    "$(get_docker_packages)" \
    "docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin" \
    "Docker 安装包列表应与官方文档保持一致，不应包含额外插件"

  FORCE_REFRESH_REPO=0
  parse_args --refresh-repo
  assert_eq "$FORCE_REFRESH_REPO" "1" "--refresh-repo 应开启仓库刷新开关"

  local temp_repo
  temp_repo="$(mktemp -d)"
  mkdir -p "$temp_repo/backend"
  REPO_DIR="$temp_repo"
  DEPLOY_HOST="8.8.8.8"
  USE_CN_MIRROR=1
  FRONTEND_PORT=""
  BACKEND_PORT=""
  MYSQL_PORT=""
  MYSQL_ROOT_PASSWORD=""
  MYSQL_PASSWORD=""
  MYSQL_USER=""
  MYSQL_DATABASE=""
  JWT_SECRET=""
  load_or_generate_env
  assert_eq "$APT_MIRROR" "http://mirrors.tuna.tsinghua.edu.cn/debian" "中国大陆环境下的 Debian 镜像应默认使用 HTTP，避免基础镜像缺证书导致 APT 失败"
  assert_eq "$APT_SECURITY_MIRROR" "http://mirrors.tuna.tsinghua.edu.cn/debian-security" "中国大陆环境下的 Debian Security 镜像应默认使用 HTTP"
  assert_eq "$ALPINE_MIRROR" "http://mirrors.tuna.tsinghua.edu.cn/alpine" "中国大陆环境下的 Alpine 镜像应默认使用 HTTP"
  rm -rf "$temp_repo"

  local archive_root reuse_target reuse_marker
  archive_root="$(mktemp -d)"
  reuse_target="${archive_root}/v-save"
  reuse_marker="${archive_root}/download-called"
  mkdir -p "${reuse_target}/backend" "${reuse_target}/frontend"
  : > "${reuse_target}/docker-compose.yml"
  USER_INSTALL_DIR="$reuse_target"
  FORCE_REFRESH_REPO=0
  REPO_DIR=""
  has_cmd() {
    if [[ "$1" == "git" ]]; then
      return 1
    fi
    command -v "$1" >/dev/null 2>&1
  }
  download_repo_archive() {
    : > "$reuse_marker"
  }
  pushd "$archive_root" >/dev/null
  ensure_repo_checkout
  popd >/dev/null
  assert_eq "$REPO_DIR" "$reuse_target" "无 git 且已有解压仓库时应默认复用现有目录"
  if [[ -f "$reuse_marker" ]]; then
    printf '断言失败：默认复用已有解压仓库时不应重新下载压缩包。\n' >&2
    exit 1
  fi
  rm -rf "$archive_root"

  local refresh_root refresh_target refresh_marker
  refresh_root="$(mktemp -d)"
  refresh_target="${refresh_root}/v-save"
  refresh_marker="${refresh_root}/download-called"
  mkdir -p "${refresh_target}/backend" "${refresh_target}/frontend"
  printf 'old-root-env\n' > "${refresh_target}/.env"
  printf 'old-backend-env\n' > "${refresh_target}/backend/.env"
  : > "${refresh_target}/docker-compose.yml"
  USER_INSTALL_DIR="$refresh_target"
  FORCE_REFRESH_REPO=1
  REPO_DIR=""
  download_repo_archive() {
    local target_dir="$1"
    rm -rf "$target_dir"
    mkdir -p "${target_dir}/backend" "${target_dir}/frontend"
    : > "${target_dir}/docker-compose.yml"
    : > "$refresh_marker"
  }
  pushd "$refresh_root" >/dev/null
  ensure_repo_checkout
  popd >/dev/null
  assert_eq "$REPO_DIR" "$refresh_target" "显式刷新仓库后应继续使用同一安装目录"
  assert_eq "$(cat "${refresh_target}/.env")" "old-root-env" "刷新压缩包时应保留根目录 .env"
  assert_eq "$(cat "${refresh_target}/backend/.env")" "old-backend-env" "刷新压缩包时应保留 backend/.env"
  if [[ ! -f "$refresh_marker" ]]; then
    printf '断言失败：显式刷新仓库时应重新下载压缩包。\n' >&2
    exit 1
  fi
  rm -rf "$refresh_root"

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
