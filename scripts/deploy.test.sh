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

  PREBUILT_BACKEND_IMAGE=""
  PREBUILT_FRONTEND_IMAGE=""
  PREBUILT_IMAGE_TAG=""
  parse_args \
    --backend-image yourname/v-save-backend \
    --frontend-image yourname/v-save-frontend \
    --image-tag 2026-04-01-test1
  assert_eq "$PREBUILT_BACKEND_IMAGE" "yourname/v-save-backend" "--backend-image 应写入后端镜像名"
  assert_eq "$PREBUILT_FRONTEND_IMAGE" "yourname/v-save-frontend" "--frontend-image 应写入前端镜像名"
  assert_eq "$PREBUILT_IMAGE_TAG" "2026-04-01-test1" "--image-tag 应写入镜像 tag"

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
  SUPER_ADMIN_EMAILS=""
  SUPER_ADMIN_BOOTSTRAP_EMAIL=""
  SUPER_ADMIN_BOOTSTRAP_PASSWORD=""
  SUPER_ADMIN_BOOTSTRAP_NICKNAME=""
  SUPER_ADMIN_PASSWORD_GENERATED=0
  PREBUILT_BACKEND_IMAGE=""
  PREBUILT_FRONTEND_IMAGE=""
  PREBUILT_IMAGE_TAG=""
  USE_PREBUILT_IMAGES=0
  load_or_generate_env
  assert_eq "$APT_MIRROR" "http://mirrors.tuna.tsinghua.edu.cn/debian" "中国大陆环境下的 Debian 镜像应默认使用 HTTP，避免基础镜像缺证书导致 APT 失败"
  assert_eq "$APT_SECURITY_MIRROR" "http://mirrors.tuna.tsinghua.edu.cn/debian-security" "中国大陆环境下的 Debian Security 镜像应默认使用 HTTP"
  assert_eq "$ALPINE_MIRROR" "http://mirrors.tuna.tsinghua.edu.cn/alpine" "中国大陆环境下的 Alpine 镜像应默认使用 HTTP"
  assert_eq "$USE_PREBUILT_IMAGES" "1" "一键部署应默认启用预构建镜像部署模式"
  assert_eq "$PREBUILT_BACKEND_IMAGE" "chopper1026/v-save-backend" "一键部署应默认使用官方后端镜像"
  assert_eq "$PREBUILT_FRONTEND_IMAGE" "chopper1026/v-save-frontend" "一键部署应默认使用官方前端镜像"
  assert_eq "$PREBUILT_IMAGE_TAG" "latest" "一键部署应默认拉取 latest 镜像"
  assert_eq "$SUPER_ADMIN_BOOTSTRAP_EMAIL" "admin@gmail.com" "应为一键部署提供默认超管邮箱"
  assert_eq "$SUPER_ADMIN_BOOTSTRAP_NICKNAME" "系统管理员" "应为一键部署提供默认超管昵称"
  assert_contains "$SUPER_ADMIN_EMAILS" "admin@gmail.com" "超级管理员邮箱列表应至少包含 bootstrap 邮箱"
  if [[ -z "$SUPER_ADMIN_BOOTSTRAP_PASSWORD" ]]; then
    printf '断言失败：首次部署应自动生成超管初始化密码。\n' >&2
    exit 1
  fi
  assert_eq "$SUPER_ADMIN_PASSWORD_GENERATED" "1" "首次部署缺少超管密码时应标记为新生成"
  rm -rf "$temp_repo"

  local state_root state_repo state_file
  state_root="$(mktemp -d)"
  state_repo="${state_root}/v-save"
  state_file="${state_root}/.v-save-deploy-state.env"
  mkdir -p "${state_repo}/backend"
  cat >"${state_repo}/.env" <<EOF
FRONTEND_PORT=8080
BACKEND_PORT=3001
MYSQL_PORT=3306
MYSQL_ROOT_PASSWORD=repo-root
MYSQL_DATABASE=repo-db
MYSQL_USER=repo-user
MYSQL_PASSWORD=repo-pass
JWT_SECRET=repo-jwt
SUPER_ADMIN_EMAILS=repo-admin@example.com
SUPER_ADMIN_BOOTSTRAP_EMAIL=repo-admin@example.com
SUPER_ADMIN_BOOTSTRAP_PASSWORD=repo-admin-pass
SUPER_ADMIN_BOOTSTRAP_NICKNAME=Repo Admin
EOF
  cat >"$state_file" <<EOF
FRONTEND_PORT=4871
BACKEND_PORT=13001
MYSQL_PORT=13306
MYSQL_ROOT_PASSWORD=state-root
MYSQL_DATABASE=state-db
MYSQL_USER=state-user
MYSQL_PASSWORD=state-pass
JWT_SECRET=state-jwt
SUPER_ADMIN_EMAILS=ops@example.com
SUPER_ADMIN_BOOTSTRAP_EMAIL=state-admin@example.com
SUPER_ADMIN_BOOTSTRAP_PASSWORD=state-admin-pass
SUPER_ADMIN_BOOTSTRAP_NICKNAME=State Admin
EOF
  REPO_DIR="$state_repo"
  DEPLOY_HOST="9.9.9.9"
  USE_CN_MIRROR=0
  FRONTEND_PORT=""
  BACKEND_PORT=""
  MYSQL_PORT=""
  MYSQL_ROOT_PASSWORD=""
  MYSQL_PASSWORD=""
  MYSQL_USER=""
  MYSQL_DATABASE=""
  JWT_SECRET=""
  SUPER_ADMIN_EMAILS=""
  SUPER_ADMIN_BOOTSTRAP_EMAIL=""
  SUPER_ADMIN_BOOTSTRAP_PASSWORD=""
  SUPER_ADMIN_BOOTSTRAP_NICKNAME=""
  SUPER_ADMIN_PASSWORD_GENERATED=0
  load_or_generate_env
  assert_eq "$FRONTEND_PORT" "4871" "状态文件应优先生效并保留前端端口"
  assert_eq "$BACKEND_PORT" "13001" "状态文件应优先生效并保留后端端口"
  assert_eq "$MYSQL_PORT" "13306" "状态文件应优先生效并保留 MySQL 端口"
  assert_eq "$MYSQL_ROOT_PASSWORD" "state-root" "状态文件应优先生效并保留 MySQL Root 密码"
  assert_eq "$MYSQL_DATABASE" "state-db" "状态文件应优先生效并保留数据库名称"
  assert_eq "$MYSQL_USER" "state-user" "状态文件应优先生效并保留数据库用户"
  assert_eq "$MYSQL_PASSWORD" "state-pass" "状态文件应优先生效并保留数据库密码"
  assert_eq "$JWT_SECRET" "state-jwt" "状态文件应优先生效并保留 JWT 密钥"
  assert_eq "$SUPER_ADMIN_BOOTSTRAP_EMAIL" "state-admin@example.com" "状态文件应优先生效并保留超管邮箱"
  assert_eq "$SUPER_ADMIN_BOOTSTRAP_PASSWORD" "state-admin-pass" "状态文件应优先生效并保留超管密码"
  assert_eq "$SUPER_ADMIN_BOOTSTRAP_NICKNAME" "State Admin" "状态文件应优先生效并保留超管昵称"
  assert_eq "$SUPER_ADMIN_EMAILS" "ops@example.com,state-admin@example.com" "超管邮箱列表应保留原值并补充 bootstrap 邮箱"
  assert_eq "$SUPER_ADMIN_PASSWORD_GENERATED" "0" "已有超管密码时不应重新生成"
  PREBUILT_BACKEND_IMAGE="yourname/v-save-backend"
  PREBUILT_FRONTEND_IMAGE="yourname/v-save-frontend"
  PREBUILT_IMAGE_TAG="2026-04-01-test1"
  USE_PREBUILT_IMAGES=1
  write_env_files
  assert_contains "$(cat "$state_file")" "MYSQL_PASSWORD=state-pass" "写回配置时应同步刷新状态文件"
  assert_contains "$(cat "${state_repo}/.env")" "MYSQL_PASSWORD=state-pass" "根目录 .env 应与状态文件保持一致"
  assert_contains "$(cat "$state_file")" "SUPER_ADMIN_BOOTSTRAP_PASSWORD=state-admin-pass" "状态文件应同步写回超管初始化密码"
  assert_contains "$(cat "${state_repo}/.env")" "SUPER_ADMIN_BOOTSTRAP_PASSWORD=state-admin-pass" "根目录 .env 应同步写回超管初始化密码"
  assert_contains "$(cat "${state_repo}/backend/.env")" "SUPER_ADMIN_EMAILS=ops@example.com,state-admin@example.com" "backend/.env 应写入合并后的超管邮箱列表"
  assert_contains "$(cat "$state_file")" "V_SAVE_USE_PREBUILT_IMAGES=1" "状态文件应持久化预构建镜像部署模式开关"
  assert_contains "$(cat "${state_repo}/.env")" "V_SAVE_BACKEND_IMAGE=yourname/v-save-backend" "根目录 .env 应写入后端预构建镜像名"
  assert_contains "$(cat "${state_repo}/.env")" "V_SAVE_FRONTEND_IMAGE=yourname/v-save-frontend" "根目录 .env 应写入前端预构建镜像名"
  assert_contains "$(cat "${state_repo}/.env")" "V_SAVE_IMAGE_TAG=2026-04-01-test1" "根目录 .env 应写入预构建镜像 tag"
  rm -rf "$state_root"

  local mysql_reconcile_marker
  mysql_reconcile_marker="$(mktemp)"
  rm -f "$mysql_reconcile_marker"
  mysql_login_with_current_app_credentials() {
    [[ -f "$mysql_reconcile_marker" ]]
  }
  mysql_login_with_current_root_credentials() {
    return 0
  }
  reconcile_mysql_app_credentials() {
    : > "$mysql_reconcile_marker"
  }
  ensure_mysql_credentials
  if [[ ! -f "$mysql_reconcile_marker" ]]; then
    printf '断言失败：应用账号登录失败但 Root 凭据可用时，应自动同步 MySQL 应用账号密码。\n' >&2
    exit 1
  fi
  rm -f "$mysql_reconcile_marker"

  local mysql_wait_attempts
  mysql_wait_attempts=0
  sleep() {
    :
  }
  mysql_login_with_current_app_credentials() {
    mysql_wait_attempts=$((mysql_wait_attempts + 1))
    [[ "$mysql_wait_attempts" -ge 3 ]]
  }
  mysql_login_with_current_root_credentials() {
    return 1
  }
  reconcile_mysql_app_credentials() {
    return 0
  }
  ensure_mysql_credentials
  if [[ "$mysql_wait_attempts" -lt 3 ]]; then
    printf '断言失败：MySQL 初始化期间应用账号暂不可用时，脚本应等待凭据就绪后再继续。\n' >&2
    exit 1
  fi
  unset -f sleep

  local archive_root reuse_target reuse_marker
  archive_root="$(mktemp -d)"
  reuse_target="${archive_root}/v-save"
  reuse_marker="${archive_root}/download-called"
  mkdir -p "${reuse_target}/backend" "${reuse_target}/frontend"
  : > "${reuse_target}/docker-compose.yml"
  : > "${reuse_target}/docker-compose.release.yml"
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
  : > "${refresh_target}/docker-compose.release.yml"
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

  local stale_archive_root stale_archive_target stale_archive_marker
  stale_archive_root="$(mktemp -d)"
  stale_archive_target="${stale_archive_root}/v-save"
  stale_archive_marker="${stale_archive_root}/download-called"
  mkdir -p "${stale_archive_target}/backend" "${stale_archive_target}/frontend"
  printf 'keep-root-env\n' > "${stale_archive_target}/.env"
  printf 'keep-backend-env\n' > "${stale_archive_target}/backend/.env"
  : > "${stale_archive_target}/docker-compose.yml"
  USER_INSTALL_DIR="$stale_archive_target"
  FORCE_REFRESH_REPO=0
  REPO_DIR=""
  download_repo_archive() {
    local target_dir="$1"
    rm -rf "$target_dir"
    mkdir -p "${target_dir}/backend" "${target_dir}/frontend"
    : > "${target_dir}/docker-compose.yml"
    : > "${target_dir}/docker-compose.release.yml"
    : > "$stale_archive_marker"
  }
  pushd "$stale_archive_root" >/dev/null
  ensure_repo_checkout
  popd >/dev/null
  assert_eq "$REPO_DIR" "$stale_archive_target" "旧版解压仓库缺少 release compose 时应自动刷新到新版目录"
  assert_eq "$(cat "${stale_archive_target}/.env")" "keep-root-env" "自动刷新旧版解压仓库时应保留根目录 .env"
  assert_eq "$(cat "${stale_archive_target}/backend/.env")" "keep-backend-env" "自动刷新旧版解压仓库时应保留 backend/.env"
  if [[ ! -f "$stale_archive_marker" ]]; then
    printf '断言失败：旧版解压仓库缺少 release compose 时应自动重新下载压缩包。\n' >&2
    exit 1
  fi
  rm -rf "$stale_archive_root"

  local git_reuse_root git_reuse_target git_reuse_log
  git_reuse_root="$(mktemp -d)"
  git_reuse_target="${git_reuse_root}/v-save"
  git_reuse_log="${git_reuse_root}/git.log"
  mkdir -p "${git_reuse_target}/.git"
  mkdir -p "${git_reuse_target}/backend" "${git_reuse_target}/frontend"
  : > "${git_reuse_target}/docker-compose.yml"
  : > "${git_reuse_target}/docker-compose.release.yml"
  USER_INSTALL_DIR="$git_reuse_target"
  FORCE_REFRESH_REPO=0
  REPO_DIR=""
  git() {
    printf '%s\n' "$*" >> "$git_reuse_log"
  }
  pushd "$git_reuse_root" >/dev/null
  ensure_repo_checkout
  popd >/dev/null
  assert_eq "$REPO_DIR" "$git_reuse_target" "已有 git 仓库且未显式刷新时应继续复用当前目录"
  if [[ -f "$git_reuse_log" ]]; then
    printf '断言失败：默认复用已有 git 仓库时不应自动执行 fetch/pull。\n' >&2
    exit 1
  fi
  rm -rf "$git_reuse_root"

  local stale_git_root stale_git_target stale_git_log
  stale_git_root="$(mktemp -d)"
  stale_git_target="${stale_git_root}/v-save"
  stale_git_log="${stale_git_root}/git.log"
  mkdir -p "${stale_git_target}/.git"
  : > "${stale_git_target}/docker-compose.yml"
  mkdir -p "${stale_git_target}/backend" "${stale_git_target}/frontend"
  USER_INSTALL_DIR="$stale_git_target"
  FORCE_REFRESH_REPO=0
  REPO_DIR=""
  git() {
    printf '%s\n' "$*" >> "$stale_git_log"
    if [[ "$1" == "-C" && "$3" == "pull" ]]; then
      : > "${stale_git_target}/docker-compose.release.yml"
    fi
  }
  pushd "$stale_git_root" >/dev/null
  ensure_repo_checkout
  popd >/dev/null
  assert_eq "$REPO_DIR" "$stale_git_target" "旧版 git 仓库缺少 release compose 时应自动刷新到新版目录"
  assert_contains "$(cat "$stale_git_log")" "-C ${stale_git_target} fetch --all --prune" "旧版 git 仓库缺少 release compose 时应自动执行 git fetch"
  assert_contains "$(cat "$stale_git_log")" "-C ${stale_git_target} pull --ff-only" "旧版 git 仓库缺少 release compose 时应自动执行 git pull"
  rm -rf "$stale_git_root"

  local git_refresh_root git_refresh_target git_refresh_log
  git_refresh_root="$(mktemp -d)"
  git_refresh_target="${git_refresh_root}/v-save"
  git_refresh_log="${git_refresh_root}/git.log"
  mkdir -p "${git_refresh_target}/.git"
  mkdir -p "${git_refresh_target}/backend" "${git_refresh_target}/frontend"
  : > "${git_refresh_target}/docker-compose.yml"
  : > "${git_refresh_target}/docker-compose.release.yml"
  USER_INSTALL_DIR="$git_refresh_target"
  FORCE_REFRESH_REPO=1
  REPO_DIR=""
  git() {
    printf '%s\n' "$*" >> "$git_refresh_log"
  }
  pushd "$git_refresh_root" >/dev/null
  ensure_repo_checkout
  popd >/dev/null
  assert_eq "$REPO_DIR" "$git_refresh_target" "显式刷新已有 git 仓库后应继续使用同一安装目录"
  assert_contains "$(cat "$git_refresh_log")" "-C ${git_refresh_target} fetch --all --prune" "显式刷新已有 git 仓库时应执行 git fetch"
  assert_contains "$(cat "$git_refresh_log")" "-C ${git_refresh_target} pull --ff-only" "显式刷新已有 git 仓库时应执行 git pull"
  rm -rf "$git_refresh_root"

  local deploy_calls
  deploy_calls="$(mktemp)"
  REPO_DIR="$(mktemp -d)"
  wait_for_container_ready() {
    return 0
  }
  ensure_mysql_credentials() {
    return 0
  }
  capture_deploy_artifacts() {
    return 0
  }
  compose_cmd() {
    printf '%s\n' "$*" >> "$deploy_calls"
  }
  deploy_stack
  assert_contains "$(cat "$deploy_calls")" "--profile with-mysql up -d mysql" "部署时应先启动 MySQL"
  assert_contains "$(cat "$deploy_calls")" "--profile with-mysql pull backend frontend" "预构建镜像模式应先拉取后端与前端镜像"
  assert_contains "$(cat "$deploy_calls")" "--profile with-mysql up -d backend frontend" "预构建镜像模式应直接启动现成镜像"
  assert_not_contains "$(cat "$deploy_calls")" "--build backend frontend" "预构建镜像模式不应触发本地构建"
  rm -f "$deploy_calls"
  rm -rf "$REPO_DIR"

  PROJECT_NAME="V-SAVE"
  WEB_PUBLIC_ORIGIN="http://demo.example.com"
  PUBLIC_API_ORIGIN="http://demo.example.com/api"
  MYSQL_PORT="3306"
  MYSQL_DATABASE="v_save"
  MYSQL_USER="vsave_user"
  MYSQL_PASSWORD="app-secret"
  MYSQL_ROOT_PASSWORD="root-secret"
  SUPER_ADMIN_BOOTSTRAP_EMAIL="admin@gmail.com"
  SUPER_ADMIN_BOOTSTRAP_PASSWORD="bootstrap-secret"
  SUPER_ADMIN_PASSWORD_GENERATED=1
  DEPLOY_DURATION_SECONDS=1574
  BACKEND_IMAGE_SIZE="1.93GB"
  FRONTEND_IMAGE_SIZE="94.7MB"
  REPO_DIR="/tmp/v-save"

  local credential_notice
  credential_notice="$(show_super_admin_credentials)"
  assert_contains "$credential_notice" "超级管理员邮箱：admin@gmail.com" "超管凭据提示应显示邮箱"
  assert_contains "$credential_notice" "超级管理员密码：bootstrap-secret" "超管凭据提示应始终显示当前密码"

  local summary
  summary="$(show_summary)"
  assert_contains "$summary" "前端访问地址：http://demo.example.com" "部署摘要应保留访问地址"
  assert_contains "$summary" "配置文件位置：/tmp/v-save/.env" "部署摘要应保留配置文件位置"
  assert_contains "$summary" "数据库密码：app-secret" "部署摘要应显示应用数据库密码"
  assert_contains "$summary" "数据库 Root 密码：root-secret" "部署摘要应显示 Root 密码"
  assert_contains "$summary" "超级管理员邮箱：admin@gmail.com" "部署摘要应显示超管邮箱"
  assert_contains "$summary" "超级管理员密码：bootstrap-secret" "首次生成超管密码时应在摘要中回显一次"
  assert_contains "$summary" "注册入口默认状态：关闭" "部署摘要应提示注册入口默认关闭"
  assert_contains "$summary" "本次部署耗时：1574 秒" "部署摘要应显示本次部署耗时"
  assert_contains "$summary" "后端镜像大小：1.93GB" "部署摘要应显示后端镜像大小"
  assert_contains "$summary" "前端镜像大小：94.7MB" "部署摘要应显示前端镜像大小"

  SUPER_ADMIN_PASSWORD_GENERATED=0
  credential_notice="$(show_super_admin_credentials)"
  assert_contains "$credential_notice" "超级管理员密码：bootstrap-secret" "复用既有超管密码时提示也应继续明文输出"
  assert_contains "$credential_notice" "脚本本次未重置" "复用既有超管密码时应明确说明密码未被重置"
  summary="$(show_summary)"
  assert_contains "$summary" "超级管理员密码：bootstrap-secret" "重跑脚本时摘要也应继续明文输出当前超管密码"
  assert_contains "$summary" "脚本本次未重置" "重跑脚本时摘要应说明密码沿用现有初始化配置"

  printf 'deploy.sh 测试通过。\n'
}

main "$@"
