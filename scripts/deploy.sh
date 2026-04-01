#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="V-SAVE"
PROJECT_SLUG="v-save"
REPO_URL_DEFAULT="https://github.com/chopper1026/v-save.git"
REPO_ARCHIVE_URL_DEFAULT="https://github.com/chopper1026/v-save/archive/refs/heads/main.tar.gz"
DEFAULT_INSTALL_DIR_ROOT="/opt/${PROJECT_SLUG}"
DEFAULT_INSTALL_DIR_USER="${HOME}/${PROJECT_SLUG}"
DEFAULT_DB_NAME="v_save"
DEFAULT_DB_USER="vsave_user"
DEFAULT_TIMEZONE="Asia/Shanghai"

FORCE_YES=0
FORCE_REFRESH_REPO=0
USER_REPO_URL="${V_SAVE_REPO_URL:-$REPO_URL_DEFAULT}"
USER_REPO_ARCHIVE_URL="${V_SAVE_REPO_ARCHIVE_URL:-$REPO_ARCHIVE_URL_DEFAULT}"
USER_INSTALL_DIR="${V_SAVE_INSTALL_DIR:-}"
USER_PUBLIC_HOST="${V_SAVE_PUBLIC_HOST:-}"
FORCE_REGION="${V_SAVE_FORCE_REGION:-}"
USE_PREBUILT_IMAGES="${V_SAVE_USE_PREBUILT_IMAGES:-}"
PREBUILT_BACKEND_IMAGE="${V_SAVE_BACKEND_IMAGE:-}"
PREBUILT_FRONTEND_IMAGE="${V_SAVE_FRONTEND_IMAGE:-}"
PREBUILT_IMAGE_TAG="${V_SAVE_IMAGE_TAG:-}"

REPO_DIR=""
DEPLOY_HOST=""
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
DEPLOY_DURATION_SECONDS=""
BACKEND_IMAGE_SIZE=""
FRONTEND_IMAGE_SIZE=""
PUBLIC_API_ORIGIN=""
WEB_PUBLIC_ORIGIN=""
CORS_ORIGINS=""
NPM_REGISTRY=""
PIP_INDEX_URL=""
APT_MIRROR=""
APT_SECURITY_MIRROR=""
ALPINE_MIRROR=""
USE_CN_MIRROR=0

DOCKER_SUDO=()
USE_DOCKER_COMPOSE_STANDALONE=0
REPO_CHANGED=0

log_info() {
  printf '[信息] %s\n' "$*"
}

log_warn() {
  printf '[提示] %s\n' "$*"
}

log_error() {
  printf '[错误] %s\n' "$*" >&2
}

log_success() {
  printf '[完成] %s\n' "$*"
}

die() {
  log_error "$*"
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
    return
  fi
  if has_cmd sudo; then
    sudo "$@"
    return
  fi
  die '当前账号既不是 root，也没有 sudo，无法执行需要管理员权限的安装步骤。'
}

normalize_arch() {
  case "${1:-}" in
    x86_64|amd64)
      printf 'amd64\n'
      ;;
    aarch64|arm64)
      printf 'arm64\n'
      ;;
    armv7l|armv7)
      printf 'armv7\n'
      ;;
    *)
      printf '%s\n' "${1:-unknown}"
      ;;
  esac
}

is_yes_answer() {
  local answer
  answer="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ -z "$answer" || "$answer" == "y" || "$answer" == "yes" || "$answer" == "是" ]]
}

normalize_flag_value() {
  local answer
  answer="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "$answer" in
    1|y|yes|true|on|是)
      printf '1\n'
      ;;
    *)
      printf '0\n'
      ;;
  esac
}

build_http_origin() {
  local host="$1"
  local port="$2"
  if [[ "$port" == "80" ]]; then
    printf 'http://%s\n' "$host"
    return
  fi
  printf 'http://%s:%s\n' "$host" "$port"
}

build_cors_origins() {
  local host="$1"
  local frontend_port="$2"
  local web_origin
  web_origin="$(build_http_origin "$host" "$frontend_port")"
  printf 'http://localhost,http://127.0.0.1,http://localhost:3000,http://127.0.0.1:3000,http://localhost:%s,http://127.0.0.1:%s,%s\n' \
    "$frontend_port" \
    "$frontend_port" \
    "$web_origin"
}

read_env_value() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  awk -F= -v target="$key" '$1 == target {print substr($0, index($0, "=") + 1)}' "$file" | tail -n 1
}

get_state_file_path() {
  if [[ -z "${REPO_DIR:-}" ]]; then
    printf '%s\n' "${HOME}/.${PROJECT_SLUG}-deploy-state.env"
    return
  fi

  printf '%s/.%s-deploy-state.env\n' "$(dirname "$REPO_DIR")" "$PROJECT_SLUG"
}

read_preferred_env_value() {
  local primary_file="$1"
  local secondary_file="$2"
  local key="$3"
  local value=""

  value="$(read_env_value "$primary_file" "$key")"
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
    return
  fi

  read_env_value "$secondary_file" "$key"
}

normalize_super_admin_email() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs
}

normalize_super_admin_emails() {
  local raw="${1:-}"
  local -a entries=()
  local -a normalized_entries=()
  local seen=","
  local entry=""
  local IFS=','

  if [[ -n "$raw" ]]; then
    read -r -a entries <<< "$raw"
  fi

  for entry in ${entries[@]+"${entries[@]}"}; do
    entry="$(normalize_super_admin_email "$entry")"
    [[ -n "$entry" ]] || continue
    case "$seen" in
      *",$entry,"*)
        ;;
      *)
        normalized_entries+=("$entry")
        seen="${seen}${entry},"
        ;;
    esac
  done

  local joined=""
  for entry in ${normalized_entries[@]+"${normalized_entries[@]}"}; do
    joined="${joined:+${joined},}${entry}"
  done

  printf '%s\n' "$joined"
}

format_duration_seconds() {
  local seconds="${1:-}"

  if [[ ! "$seconds" =~ ^[0-9]+$ ]]; then
    printf '未获取\n'
    return
  fi

  printf '%s 秒' "$seconds"
  if (( seconds >= 60 )); then
    printf '（%d 分 %d 秒）' "$((seconds / 60))" "$((seconds % 60))"
  fi
  printf '\n'
}

format_bytes_human() {
  local bytes="${1:-}"

  if [[ ! "$bytes" =~ ^[0-9]+$ ]]; then
    printf '未获取\n'
    return
  fi

  awk -v bytes="$bytes" '
    BEGIN {
      split("B KB MB GB TB PB", units, " ");
      value = bytes + 0;
      unit_index = 1;
      while (value >= 1024 && unit_index < 6) {
        value /= 1024;
        unit_index++;
      }

      if (unit_index == 1) {
        printf "%d%s\n", value, units[unit_index];
        exit;
      }

      if (value >= 100) {
        printf "%.0f%s\n", value, units[unit_index];
        exit;
      }

      if (value >= 10) {
        printf "%.1f%s\n", value, units[unit_index];
        exit;
      }

      printf "%.2f%s\n", value, units[unit_index];
    }
  '
}

read_container_image_size() {
  local container_name="$1"
  local image_id=""
  local image_bytes=""

  image_id="$(docker_cmd inspect -f '{{.Image}}' "$container_name" 2>/dev/null || true)"
  [[ -n "$image_id" ]] || return 1

  image_bytes="$(docker_cmd image inspect "$image_id" --format '{{.Size}}' 2>/dev/null || true)"
  [[ "$image_bytes" =~ ^[0-9]+$ ]] || return 1

  format_bytes_human "$image_bytes"
}

capture_deploy_artifacts() {
  BACKEND_IMAGE_SIZE="$(read_container_image_size "v-save-backend" || true)"
  FRONTEND_IMAGE_SIZE="$(read_container_image_size "v-save-frontend" || true)"
}

ensure_super_admin_email_in_list() {
  local normalized_list
  local normalized_email

  normalized_list="$(normalize_super_admin_emails "${1:-}")"
  normalized_email="$(normalize_super_admin_email "${2:-}")"

  if [[ -z "$normalized_email" ]]; then
    printf '%s\n' "$normalized_list"
    return
  fi

  case ",${normalized_list}," in
    *",$normalized_email,"*)
      printf '%s\n' "$normalized_list"
      ;;
    *)
      if [[ -n "$normalized_list" ]]; then
        printf '%s,%s\n' "$normalized_list" "$normalized_email"
      else
        printf '%s\n' "$normalized_email"
      fi
      ;;
  esac
}

generate_secret() {
  if has_cmd openssl; then
    openssl rand -base64 48 | tr -d '\n' | tr '/+' '_-' | cut -c1-36
    return
  fi
  python3 - <<'PY'
import secrets
alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=_-"
print("".join(secrets.choice(alphabet) for _ in range(36)))
PY
}

is_port_in_use() {
  local port="$1"
  if has_cmd ss; then
    ss -ltn "( sport = :${port} )" | awk 'NR > 1 { exit 0 } END { exit 1 }'
    return $?
  fi
  if has_cmd lsof; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

choose_available_port() {
  local preferred_ports=("$@")
  local port
  for port in "${preferred_ports[@]}"; do
    if ! is_port_in_use "$port"; then
      printf '%s\n' "$port"
      return
    fi
  done

  local candidate=20000
  while is_port_in_use "$candidate"; do
    candidate=$((candidate + 1))
  done
  printf '%s\n' "$candidate"
}

get_country_code() {
  local endpoint
  for endpoint in \
    "https://ipapi.co/country/" \
    "https://ifconfig.co/country-iso" \
    "https://ipinfo.io/country"
  do
    if country="$(curl -fsSL --max-time 5 "$endpoint" 2>/dev/null | tr -d '\r\n[:space:]')" && [[ -n "$country" ]]; then
      printf '%s\n' "$country"
      return
    fi
  done
}

detect_china_mainland() {
  local forced="${FORCE_REGION,,}"
  if [[ "$forced" == "cn" ]]; then
    return 0
  fi
  if [[ "$forced" == "global" ]]; then
    return 1
  fi

  local country=""
  country="$(get_country_code || true)"
  if [[ "${country^^}" == "CN" ]]; then
    return 0
  fi

  if curl -fsSL --max-time 4 https://www.baidu.com >/dev/null 2>&1 \
    && ! curl -fsSL --max-time 4 https://registry-1.docker.io/v2/ >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

prompt_yes_no() {
  local message="$1"
  if [[ "$FORCE_YES" -eq 1 ]]; then
    return 0
  fi
  local answer=""
  read -r -p "${message} [Y/n] " answer
  is_yes_answer "$answer"
}

resolve_install_dir() {
  if [[ -n "$USER_INSTALL_DIR" ]]; then
    printf '%s\n' "$USER_INSTALL_DIR"
    return
  fi

  if [[ -d /opt && -w /opt ]]; then
    printf '%s\n' "$DEFAULT_INSTALL_DIR_ROOT"
    return
  fi

  printf '%s\n' "$DEFAULT_INSTALL_DIR_USER"
}

ensure_sudo_prefix() {
  if docker info >/dev/null 2>&1; then
    DOCKER_SUDO=()
    return
  fi
  if has_cmd sudo && sudo docker info >/dev/null 2>&1; then
    DOCKER_SUDO=(sudo)
    return
  fi
  DOCKER_SUDO=()
}

compose_cmd() {
  local -a compose_file_args=()
  if [[ "${USE_PREBUILT_IMAGES:-0}" -eq 1 ]]; then
    compose_file_args=(-f docker-compose.release.yml)
  fi

  if [[ "$USE_DOCKER_COMPOSE_STANDALONE" -eq 1 ]]; then
    "${DOCKER_SUDO[@]}" docker-compose "${compose_file_args[@]}" "$@"
  else
    "${DOCKER_SUDO[@]}" docker compose "${compose_file_args[@]}" "$@"
  fi
}

docker_cmd() {
  "${DOCKER_SUDO[@]}" docker "$@"
}

resolve_compose_command() {
  ensure_sudo_prefix
  if "${DOCKER_SUDO[@]}" docker compose version >/dev/null 2>&1; then
    USE_DOCKER_COMPOSE_STANDALONE=0
    return
  fi
  if "${DOCKER_SUDO[@]}" docker-compose version >/dev/null 2>&1; then
    USE_DOCKER_COMPOSE_STANDALONE=1
    return
  fi
  die '未检测到可用的 Docker Compose。'
}

install_compose_plugin_if_needed() {
  if "${DOCKER_SUDO[@]}" docker compose version >/dev/null 2>&1; then
    USE_DOCKER_COMPOSE_STANDALONE=0
    return
  fi

  local os_id=""
  if [[ -f /etc/os-release ]]; then
    os_id="$(. /etc/os-release && printf '%s' "${ID:-}")"
  fi

  case "$os_id" in
    ubuntu|debian|raspbian)
      "${DOCKER_SUDO[@]}" apt-get update -y >/dev/null
      "${DOCKER_SUDO[@]}" apt-get install -y docker-compose-plugin >/dev/null
      ;;
    centos|rhel|rocky|almalinux|fedora)
      if has_cmd dnf; then
        "${DOCKER_SUDO[@]}" dnf install -y docker-compose-plugin >/dev/null
      else
        "${DOCKER_SUDO[@]}" yum install -y docker-compose-plugin >/dev/null
      fi
      ;;
    *)
      ;;
  esac

  if "${DOCKER_SUDO[@]}" docker compose version >/dev/null 2>&1; then
    USE_DOCKER_COMPOSE_STANDALONE=0
    return
  fi
  if "${DOCKER_SUDO[@]}" docker-compose version >/dev/null 2>&1; then
    USE_DOCKER_COMPOSE_STANDALONE=1
    return
  fi
  die 'Docker 已安装，但 Compose 组件不可用，请手动安装后重试。'
}

get_docker_install_script_url() {
  if [[ "$USE_CN_MIRROR" -eq 1 ]]; then
    printf '%s\n' "${V_SAVE_DOCKER_INSTALL_SCRIPT_URL_CN:-${V_SAVE_DOCKER_INSTALL_SCRIPT_URL:-https://raw.githubusercontent.com/docker/docker-install/master/install.sh}}"
    return
  fi

  printf '%s\n' "${V_SAVE_DOCKER_INSTALL_SCRIPT_URL:-https://get.docker.com}"
}

get_docker_install_mirror_flag() {
  if [[ "$USE_CN_MIRROR" -eq 1 ]]; then
    printf '%s\n' "${V_SAVE_DOCKER_INSTALL_MIRROR_CN:-${V_SAVE_DOCKER_INSTALL_MIRROR:-AzureChinaCloud}}"
    return
  fi

  printf '\n'
}

get_docker_repo_root_url() {
  if [[ "$USE_CN_MIRROR" -eq 1 ]]; then
    printf '%s\n' "${V_SAVE_DOCKER_REPO_ROOT_CN:-${V_SAVE_DOCKER_REPO_ROOT:-https://mirror.azure.cn/docker-ce/linux}}"
    return
  fi

  printf '%s\n' "${V_SAVE_DOCKER_REPO_ROOT:-https://download.docker.com/linux}"
}

get_docker_rpm_repo_url() {
  local os_id="${1:-}"
  local repo_family="centos"

  case "$os_id" in
    fedora)
      repo_family="fedora"
      ;;
  esac

  printf '%s/%s/docker-ce.repo\n' "$(get_docker_repo_root_url)" "$repo_family"
}

get_docker_packages() {
  printf '%s\n' "docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
}

get_os_release_value() {
  local key="$1"
  if [[ ! -f /etc/os-release ]]; then
    return 0
  fi
  awk -F= -v target="$key" '$1 == target {print substr($0, index($0, "=") + 1)}' /etc/os-release | tr -d '"' | tail -n 1
}

install_docker_with_apt() {
  local os_id="$1"
  local codename="$2"
  local repo_root
  local packages

  repo_root="$(get_docker_repo_root_url)"
  packages="$(get_docker_packages)"

  log_info "开始通过 APT 安装 Docker（${os_id}/${codename}）..."
  run_as_root apt-get update -y
  run_as_root apt-get install -y ca-certificates curl
  run_as_root install -m 0755 -d /etc/apt/keyrings
  run_as_root curl -fsSL "${repo_root}/${os_id}/gpg" -o /etc/apt/keyrings/docker.asc
  run_as_root chmod a+r /etc/apt/keyrings/docker.asc
  run_as_root tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: ${repo_root}/${os_id}
Suites: ${codename}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  run_as_root apt-get update -y
  run_as_root apt-get install -y ${packages}
}

install_docker_with_dnf() {
  local os_id="$1"
  local repo_url
  local packages

  repo_url="$(get_docker_rpm_repo_url "$os_id")"
  packages="$(get_docker_packages)"

  log_info "开始通过 DNF/YUM 安装 Docker（${os_id}）..."
  if has_cmd dnf; then
    run_as_root dnf -y --setopt=install_weak_deps=False install dnf-plugins-core
    run_as_root rm -f /etc/yum.repos.d/docker-ce.repo /etc/yum.repos.d/docker-ce-staging.repo
    run_as_root dnf config-manager --add-repo "$repo_url"
    run_as_root dnf makecache
    run_as_root dnf -y install ${packages}
    return
  fi

  run_as_root yum install -y yum-utils
  run_as_root rm -f /etc/yum.repos.d/docker-ce.repo /etc/yum.repos.d/docker-ce-staging.repo
  run_as_root yum-config-manager --add-repo "$repo_url"
  run_as_root yum makecache
  run_as_root yum install -y ${packages}
}

install_docker_with_convenience_script() {
  log_warn '当前发行版未命中受控安装路径，回退到 Docker 官方安装脚本。'
  local temp_script
  local install_script_url
  local install_mirror

  install_script_url="$(get_docker_install_script_url)"
  install_mirror="$(get_docker_install_mirror_flag)"
  temp_script="$(mktemp)"

  if ! curl -fsSL "$install_script_url" -o "$temp_script"; then
    rm -f "$temp_script"
    die "下载 Docker 安装脚本失败：${install_script_url}"
  fi

  local install_cmd=(sh "$temp_script")
  if [[ -n "$install_mirror" ]]; then
    log_info "检测到中国大陆网络环境，将使用 Docker 安装镜像：${install_mirror}"
    install_cmd+=(--mirror "$install_mirror")
  fi

  run_as_root "${install_cmd[@]}"
  rm -f "$temp_script"
}

install_docker() {
  local os_id=""
  local codename=""

  os_id="$(get_os_release_value ID)"
  codename="$(get_os_release_value VERSION_CODENAME)"
  [[ -n "$codename" ]] || codename="$(get_os_release_value UBUNTU_CODENAME)"

  case "$os_id" in
    ubuntu|debian|raspbian)
      [[ -n "$codename" ]] || die '当前系统未提供 VERSION_CODENAME，无法自动配置 Docker APT 源。'
      install_docker_with_apt "$os_id" "$codename"
      ;;
    fedora|centos|rhel|rocky|almalinux|ol|opencloudos|anolis|alinux|velinux)
      install_docker_with_dnf "$os_id"
      ;;
    *)
      install_docker_with_convenience_script
      ;;
  esac

  ensure_sudo_prefix
  if has_cmd systemctl; then
    "${DOCKER_SUDO[@]}" systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  install_compose_plugin_if_needed
  log_success 'Docker 安装完成。'
}

ensure_docker_environment() {
  if has_cmd docker; then
    ensure_sudo_prefix
    if "${DOCKER_SUDO[@]}" docker info >/dev/null 2>&1; then
      install_compose_plugin_if_needed
      resolve_compose_command
      return
    fi
  fi

  log_warn '未检测到可用的 Docker 运行环境。'
  if ! prompt_yes_no '是否现在自动安装 Docker 与 Docker Compose？'; then
    die '用户取消了 Docker 安装，部署终止。'
  fi

  install_docker
  resolve_compose_command
}

configure_docker_mirror() {
  if [[ "$USE_CN_MIRROR" -ne 1 ]]; then
    return
  fi

  local daemon_path="/etc/docker/daemon.json"
  local mirror_one="${V_SAVE_DOCKER_MIRROR_PRIMARY:-https://docker.m.daocloud.io}"
  local mirror_two="${V_SAVE_DOCKER_MIRROR_SECONDARY:-https://docker.1ms.run}"

  if [[ $EUID -ne 0 ]] && ! has_cmd sudo; then
    log_warn '当前无法写入 Docker daemon 配置，跳过 Docker Hub 镜像加速设置。'
    return
  fi

  local writer=(cat)
  if [[ $EUID -ne 0 ]]; then
    writer=(sudo tee)
  fi

  if has_cmd python3; then
    "${DOCKER_SUDO[@]}" mkdir -p /etc/docker
    "${DOCKER_SUDO[@]}" python3 - "$daemon_path" "$mirror_one" "$mirror_two" <<'PY'
import json
import os
import sys

path = sys.argv[1]
mirrors = [item for item in sys.argv[2:] if item]
data = {}

if os.path.exists(path):
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
    except Exception:
        data = {}

existing = data.get("registry-mirrors", [])
ordered = []
for item in existing + mirrors:
    if item and item not in ordered:
        ordered.append(item)
data["registry-mirrors"] = ordered

with open(path, 'w', encoding='utf-8') as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
  elif [[ ! -f "$daemon_path" ]]; then
    "${writer[@]}" "$daemon_path" >/dev/null <<EOF
{
  "registry-mirrors": [
    "${mirror_one}",
    "${mirror_two}"
  ]
}
EOF
  else
    log_warn '系统没有 python3，且已存在 /etc/docker/daemon.json，跳过 Docker Hub 镜像加速合并。'
    return
  fi

  if has_cmd systemctl; then
    "${DOCKER_SUDO[@]}" systemctl restart docker >/dev/null 2>&1 || true
  fi
  log_success '已为中国大陆网络启用 Docker 镜像加速。'
}

download_repo_archive() {
  local target_dir="$1"
  local parent_dir
  parent_dir="$(dirname "$target_dir")"
  mkdir -p "$parent_dir"

  local temp_tar
  temp_tar="$(mktemp)"
  curl -fsSL "$USER_REPO_ARCHIVE_URL" -o "$temp_tar"

  local temp_extract
  temp_extract="$(mktemp -d)"
  tar -xzf "$temp_tar" -C "$temp_extract"
  rm -f "$temp_tar"

  local extracted_dir
  extracted_dir="$(find "$temp_extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [[ -n "$extracted_dir" ]] || die '下载仓库压缩包后，未找到解压目录。'

  rm -rf "$target_dir"
  mkdir -p "$parent_dir"
  mv "$extracted_dir" "$target_dir"
  rm -rf "$temp_extract"
}

is_repo_checkout_dir() {
  local target_dir="$1"
  [[ -f "${target_dir}/docker-compose.yml" && -d "${target_dir}/backend" && -d "${target_dir}/frontend" ]]
}

refresh_repo_archive_preserve_state() {
  local target_dir="$1"
  local backup_dir
  backup_dir="$(mktemp -d)"

  if [[ -f "${target_dir}/.env" ]]; then
    cp "${target_dir}/.env" "${backup_dir}/root.env"
  fi
  if [[ -f "${target_dir}/backend/.env" ]]; then
    mkdir -p "${backup_dir}/backend"
    cp "${target_dir}/backend/.env" "${backup_dir}/backend/.env"
  fi

  download_repo_archive "$target_dir"

  if [[ -f "${backup_dir}/root.env" ]]; then
    cp "${backup_dir}/root.env" "${target_dir}/.env"
  fi
  if [[ -f "${backup_dir}/backend/.env" ]]; then
    mkdir -p "${target_dir}/backend"
    cp "${backup_dir}/backend/.env" "${target_dir}/backend/.env"
  fi

  rm -rf "$backup_dir"
}

ensure_repo_checkout() {
  if is_repo_checkout_dir "."; then
    REPO_DIR="$(pwd)"
    REPO_CHANGED=1
    log_info "检测到当前目录已是 ${PROJECT_NAME} 仓库，直接在本地执行部署。"
    return
  fi

  local target_dir
  target_dir="$(resolve_install_dir)"

  if [[ -d "$target_dir/.git" ]]; then
    log_info "检测到已有仓库副本：${target_dir}"
    if [[ "$FORCE_REFRESH_REPO" -eq 1 ]]; then
      git -C "$target_dir" fetch --all --prune >/dev/null
      git -C "$target_dir" pull --ff-only >/dev/null
      REPO_CHANGED=1
    else
      log_info '未指定 --refresh-repo，默认复用当前 git 仓库代码。'
      REPO_CHANGED=0
    fi
    REPO_DIR="$target_dir"
    return
  fi

  if is_repo_checkout_dir "$target_dir"; then
    if [[ "$FORCE_REFRESH_REPO" -eq 1 ]]; then
      log_info "检测到已有解压仓库副本：${target_dir}，按要求刷新最新代码并保留现有配置。"
      refresh_repo_archive_preserve_state "$target_dir"
      REPO_CHANGED=1
    else
      log_info "检测到已有解压仓库副本：${target_dir}，复用现有目录。"
      REPO_CHANGED=0
    fi
    REPO_DIR="$target_dir"
    return
  fi

  if has_cmd git; then
    log_info "开始下载仓库到：${target_dir}"
    mkdir -p "$(dirname "$target_dir")"
    if [[ -d "$target_dir" && ! -f "$target_dir/docker-compose.yml" ]]; then
      rm -rf "$target_dir"
    fi
    git clone --depth 1 "$USER_REPO_URL" "$target_dir" >/dev/null
    REPO_CHANGED=1
    REPO_DIR="$target_dir"
    return
  fi

  log_warn '系统未检测到 git，改用压缩包方式下载仓库。'
  download_repo_archive "$target_dir"
  REPO_CHANGED=1
  REPO_DIR="$target_dir"
}

detect_deploy_host() {
  if [[ -n "$USER_PUBLIC_HOST" ]]; then
    DEPLOY_HOST="$USER_PUBLIC_HOST"
    return
  fi

  local candidate=""
  for endpoint in \
    "https://api64.ipify.org" \
    "https://api.ipify.org" \
    "https://ifconfig.me"
  do
    if candidate="$(curl -fsSL --max-time 5 "$endpoint" 2>/dev/null | tr -d '\r\n[:space:]')" && [[ -n "$candidate" ]]; then
      DEPLOY_HOST="$candidate"
      return
    fi
  done

  if has_cmd hostname; then
    candidate="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [[ -n "$candidate" ]]; then
      DEPLOY_HOST="$candidate"
      return
    fi
  fi

  if has_cmd ip; then
    candidate="$(ip route get 1.1.1.1 2>/dev/null | awk '/src/ {for (i=1; i<=NF; i++) if ($i == "src") { print $(i+1); exit }}')"
    if [[ -n "$candidate" ]]; then
      DEPLOY_HOST="$candidate"
      return
    fi
  fi

  DEPLOY_HOST="127.0.0.1"
}

load_or_generate_env() {
  local env_file="${REPO_DIR}/.env"
  local state_file
  state_file="$(get_state_file_path)"

  FRONTEND_PORT="$(read_preferred_env_value "$state_file" "$env_file" "FRONTEND_PORT")"
  BACKEND_PORT="$(read_preferred_env_value "$state_file" "$env_file" "BACKEND_PORT")"
  MYSQL_PORT="$(read_preferred_env_value "$state_file" "$env_file" "MYSQL_PORT")"
  MYSQL_ROOT_PASSWORD="$(read_preferred_env_value "$state_file" "$env_file" "MYSQL_ROOT_PASSWORD")"
  MYSQL_PASSWORD="$(read_preferred_env_value "$state_file" "$env_file" "MYSQL_PASSWORD")"
  MYSQL_USER="$(read_preferred_env_value "$state_file" "$env_file" "MYSQL_USER")"
  MYSQL_DATABASE="$(read_preferred_env_value "$state_file" "$env_file" "MYSQL_DATABASE")"
  JWT_SECRET="$(read_preferred_env_value "$state_file" "$env_file" "JWT_SECRET")"
  SUPER_ADMIN_EMAILS="$(read_preferred_env_value "$state_file" "$env_file" "SUPER_ADMIN_EMAILS")"
  SUPER_ADMIN_BOOTSTRAP_EMAIL="$(read_preferred_env_value "$state_file" "$env_file" "SUPER_ADMIN_BOOTSTRAP_EMAIL")"
  SUPER_ADMIN_BOOTSTRAP_PASSWORD="$(read_preferred_env_value "$state_file" "$env_file" "SUPER_ADMIN_BOOTSTRAP_PASSWORD")"
  SUPER_ADMIN_BOOTSTRAP_NICKNAME="$(read_preferred_env_value "$state_file" "$env_file" "SUPER_ADMIN_BOOTSTRAP_NICKNAME")"

  [[ -n "$USE_PREBUILT_IMAGES" ]] || USE_PREBUILT_IMAGES="$(read_preferred_env_value "$state_file" "$env_file" "V_SAVE_USE_PREBUILT_IMAGES")"
  [[ -n "$PREBUILT_BACKEND_IMAGE" ]] || PREBUILT_BACKEND_IMAGE="$(read_preferred_env_value "$state_file" "$env_file" "V_SAVE_BACKEND_IMAGE")"
  [[ -n "$PREBUILT_FRONTEND_IMAGE" ]] || PREBUILT_FRONTEND_IMAGE="$(read_preferred_env_value "$state_file" "$env_file" "V_SAVE_FRONTEND_IMAGE")"
  [[ -n "$PREBUILT_IMAGE_TAG" ]] || PREBUILT_IMAGE_TAG="$(read_preferred_env_value "$state_file" "$env_file" "V_SAVE_IMAGE_TAG")"

  [[ -n "$FRONTEND_PORT" ]] || FRONTEND_PORT="$(choose_available_port 80 4871 8080 18080)"
  [[ -n "$BACKEND_PORT" ]] || BACKEND_PORT="$(choose_available_port 3001 13001 23001)"
  [[ -n "$MYSQL_PORT" ]] || MYSQL_PORT="$(choose_available_port 3306 13306 23306)"
  [[ -n "$MYSQL_ROOT_PASSWORD" ]] || MYSQL_ROOT_PASSWORD="$(generate_secret)"
  [[ -n "$MYSQL_PASSWORD" ]] || MYSQL_PASSWORD="$(generate_secret)"
  [[ -n "$MYSQL_USER" ]] || MYSQL_USER="$DEFAULT_DB_USER"
  [[ -n "$MYSQL_DATABASE" ]] || MYSQL_DATABASE="$DEFAULT_DB_NAME"
  [[ -n "$JWT_SECRET" ]] || JWT_SECRET="$(generate_secret)"
  SUPER_ADMIN_BOOTSTRAP_EMAIL="$(normalize_super_admin_email "${SUPER_ADMIN_BOOTSTRAP_EMAIL:-admin@gmail.com}")"
  [[ -n "$SUPER_ADMIN_BOOTSTRAP_EMAIL" ]] || SUPER_ADMIN_BOOTSTRAP_EMAIL="admin@gmail.com"
  [[ -n "$SUPER_ADMIN_BOOTSTRAP_NICKNAME" ]] || SUPER_ADMIN_BOOTSTRAP_NICKNAME="系统管理员"
  if [[ -n "$SUPER_ADMIN_BOOTSTRAP_PASSWORD" ]]; then
    SUPER_ADMIN_PASSWORD_GENERATED=0
  else
    SUPER_ADMIN_BOOTSTRAP_PASSWORD="$(generate_secret)"
    SUPER_ADMIN_PASSWORD_GENERATED=1
  fi
  SUPER_ADMIN_EMAILS="$(ensure_super_admin_email_in_list "$SUPER_ADMIN_EMAILS" "$SUPER_ADMIN_BOOTSTRAP_EMAIL")"
  USE_PREBUILT_IMAGES="$(normalize_flag_value "$USE_PREBUILT_IMAGES")"
  [[ -n "$PREBUILT_IMAGE_TAG" ]] || PREBUILT_IMAGE_TAG="latest"

  PUBLIC_API_ORIGIN="$(build_http_origin "$DEPLOY_HOST" "$BACKEND_PORT")/api"
  WEB_PUBLIC_ORIGIN="$(build_http_origin "$DEPLOY_HOST" "$FRONTEND_PORT")"
  CORS_ORIGINS="$(build_cors_origins "$DEPLOY_HOST" "$FRONTEND_PORT")"

  if [[ "$USE_CN_MIRROR" -eq 1 ]]; then
    NPM_REGISTRY="${V_SAVE_NPM_REGISTRY:-https://registry.npmmirror.com}"
    PIP_INDEX_URL="${V_SAVE_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
    APT_MIRROR="${V_SAVE_APT_MIRROR:-http://mirrors.tuna.tsinghua.edu.cn/debian}"
    APT_SECURITY_MIRROR="${V_SAVE_APT_SECURITY_MIRROR:-http://mirrors.tuna.tsinghua.edu.cn/debian-security}"
    ALPINE_MIRROR="${V_SAVE_ALPINE_MIRROR:-http://mirrors.tuna.tsinghua.edu.cn/alpine}"
  else
    NPM_REGISTRY=""
    PIP_INDEX_URL=""
    APT_MIRROR=""
    APT_SECURITY_MIRROR=""
    ALPINE_MIRROR=""
  fi
}

write_state_file() {
  local state_file
  state_file="$(get_state_file_path)"

  mkdir -p "$(dirname "$state_file")"
  cat >"$state_file" <<EOF
FRONTEND_PORT=${FRONTEND_PORT}
BACKEND_PORT=${BACKEND_PORT}
MYSQL_PORT=${MYSQL_PORT}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
MYSQL_DATABASE=${MYSQL_DATABASE}
MYSQL_USER=${MYSQL_USER}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
JWT_SECRET=${JWT_SECRET}
SUPER_ADMIN_EMAILS=${SUPER_ADMIN_EMAILS}
SUPER_ADMIN_BOOTSTRAP_EMAIL=${SUPER_ADMIN_BOOTSTRAP_EMAIL}
SUPER_ADMIN_BOOTSTRAP_PASSWORD=${SUPER_ADMIN_BOOTSTRAP_PASSWORD}
SUPER_ADMIN_BOOTSTRAP_NICKNAME=${SUPER_ADMIN_BOOTSTRAP_NICKNAME}
V_SAVE_USE_PREBUILT_IMAGES=${USE_PREBUILT_IMAGES}
V_SAVE_BACKEND_IMAGE=${PREBUILT_BACKEND_IMAGE}
V_SAVE_FRONTEND_IMAGE=${PREBUILT_FRONTEND_IMAGE}
V_SAVE_IMAGE_TAG=${PREBUILT_IMAGE_TAG}
EOF
  chmod 600 "$state_file" 2>/dev/null || true
}

write_env_files() {
  cat >"${REPO_DIR}/.env" <<EOF
TZ=${DEFAULT_TIMEZONE}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
MYSQL_DATABASE=${MYSQL_DATABASE}
MYSQL_USER=${MYSQL_USER}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
MYSQL_PORT=${MYSQL_PORT}
DATABASE_HOST=mysql
DATABASE_PORT=3306
DATABASE_USER=${MYSQL_USER}
DATABASE_PASSWORD=${MYSQL_PASSWORD}
DATABASE_NAME=${MYSQL_DATABASE}
DB_SYNCHRONIZE=true
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRATION=7d
SUPER_ADMIN_EMAILS=${SUPER_ADMIN_EMAILS}
SUPER_ADMIN_BOOTSTRAP_EMAIL=${SUPER_ADMIN_BOOTSTRAP_EMAIL}
SUPER_ADMIN_BOOTSTRAP_PASSWORD=${SUPER_ADMIN_BOOTSTRAP_PASSWORD}
SUPER_ADMIN_BOOTSTRAP_NICKNAME=${SUPER_ADMIN_BOOTSTRAP_NICKNAME}
PUBLIC_API_ORIGIN=${PUBLIC_API_ORIGIN}
WEB_PUBLIC_ORIGIN=${WEB_PUBLIC_ORIGIN}
CORS_ORIGINS=${CORS_ORIGINS}
VITE_API_BASE_URL=/api
BACKEND_PORT=${BACKEND_PORT}
FRONTEND_PORT=${FRONTEND_PORT}
NODE_OPTIONS=--max-old-space-size=768 --dns-result-order=ipv4first
NPM_REGISTRY=${NPM_REGISTRY}
PIP_INDEX_URL=${PIP_INDEX_URL}
APT_MIRROR=${APT_MIRROR}
APT_SECURITY_MIRROR=${APT_SECURITY_MIRROR}
ALPINE_MIRROR=${ALPINE_MIRROR}
V_SAVE_USE_PREBUILT_IMAGES=${USE_PREBUILT_IMAGES}
V_SAVE_BACKEND_IMAGE=${PREBUILT_BACKEND_IMAGE}
V_SAVE_FRONTEND_IMAGE=${PREBUILT_FRONTEND_IMAGE}
V_SAVE_IMAGE_TAG=${PREBUILT_IMAGE_TAG}
EOF

  cat >"${REPO_DIR}/backend/.env" <<EOF
DATABASE_HOST=mysql
DATABASE_PORT=3306
DATABASE_USER=${MYSQL_USER}
DATABASE_PASSWORD=${MYSQL_PASSWORD}
DATABASE_NAME=${MYSQL_DATABASE}
DB_SYNCHRONIZE=true
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRATION=7d
SUPER_ADMIN_EMAILS=${SUPER_ADMIN_EMAILS}
SUPER_ADMIN_BOOTSTRAP_EMAIL=${SUPER_ADMIN_BOOTSTRAP_EMAIL}
SUPER_ADMIN_BOOTSTRAP_PASSWORD=${SUPER_ADMIN_BOOTSTRAP_PASSWORD}
SUPER_ADMIN_BOOTSTRAP_NICKNAME=${SUPER_ADMIN_BOOTSTRAP_NICKNAME}
PORT=3001
CORS_ORIGINS=${CORS_ORIGINS}
PUBLIC_API_ORIGIN=${PUBLIC_API_ORIGIN}
WEB_PUBLIC_ORIGIN=${WEB_PUBLIC_ORIGIN}
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
YTDLP_PATH=yt-dlp
YTDLP_CONCURRENT_FRAGMENTS=4
DOUYIN_ABOGUS_PYTHON=python3
DOUYIN_ABOGUS_HELPER_PATH=/app/tools/douyin/abogus.py
YOUTUBE_NOEMBED_ENABLED=true
DOWNLOAD_TASK_RETENTION_MS=21600000
DOWNLOAD_TASK_CLEANUP_INTERVAL_MS=600000
DOWNLOAD_TASK_CLEANUP_BATCH_SIZE=100
IOS_TRANSCODE_PRESET=veryfast
IOS_TRANSCODE_CRF=23
DOUYIN_COOKIE=
DOUYIN_PARSE_MAX_ATTEMPTS=3
DOUYIN_PARSE_CONCURRENCY=2
DOUYIN_PARSE_MIN_INTERVAL_MS=10000
DOUYIN_PARSE_CACHE_TTL_MS=1200000
DOUYIN_PARSE_RETRY_BASE_MS=800
DOUYIN_PARSE_RETRY_JITTER_MS=600
DOUYIN_DOWNLOAD_PROBE_TIMEOUT_MS=6000
DOUYIN_DOWNLOAD_PROBE_CACHE_TTL_MS=45000
DOUYIN_DOWNLOAD_PROBE_LINES=4,3,2,1,0
DOUYIN_STRICT_PROBE_CONCURRENCY=2
DOUYIN_STRICT_PROBE_BUDGET_MS=12000
KUAISHOU_BROWSER_USER_AGENT=
KUAISHOU_PARSE_MIN_INTERVAL_MS=4000
KUAISHOU_PARSE_CACHE_TTL_MS=900000
KUAISHOU_PARSE_MAX_ATTEMPTS=2
KUAISHOU_PARSE_RETRY_BASE_MS=800
KUAISHOU_PARSE_RETRY_JITTER_MS=500
KUAISHOU_RISK_COOLDOWN_THRESHOLD=3
KUAISHOU_RISK_COOLDOWN_MS=600000
KUAISHOU_QUALITY_PROBE_ENABLED=true
KUAISHOU_QUALITY_PROBE_TIMEOUT_MS=6000
KUAISHOU_QUALITY_PROBE_INTERVAL_MS=120
KUAISHOU_QUALITY_PROBE_SAMPLE_BYTES=65536
EOF

  write_state_file
}

wait_for_container_ready() {
  local container_name="$1"
  local timeout_seconds="${2:-300}"
  local elapsed=0
  local status=""

  while (( elapsed < timeout_seconds )); do
    status="$(docker_cmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  docker_cmd logs --tail 50 "$container_name" >/dev/null 2>&1 || true
  return 1
}

validate_prebuilt_image_settings() {
  if [[ "${USE_PREBUILT_IMAGES:-0}" -ne 1 ]]; then
    return 0
  fi

  [[ -n "$PREBUILT_BACKEND_IMAGE" ]] || die '启用预构建镜像部署时，必须通过 V_SAVE_BACKEND_IMAGE 或 --backend-image 提供后端镜像名。'
  [[ -n "$PREBUILT_FRONTEND_IMAGE" ]] || die '启用预构建镜像部署时，必须通过 V_SAVE_FRONTEND_IMAGE 或 --frontend-image 提供前端镜像名。'
  [[ -n "$PREBUILT_IMAGE_TAG" ]] || die '启用预构建镜像部署时，必须通过 V_SAVE_IMAGE_TAG 或 --image-tag 提供镜像 tag。'
}

compose_cli_prefix() {
  if [[ "${USE_PREBUILT_IMAGES:-0}" -eq 1 ]]; then
    printf 'docker compose -f docker-compose.release.yml'
    return
  fi

  printf 'docker compose'
}

get_compose_project_name() {
  local project_name=""
  project_name="$(compose_cmd config 2>/dev/null | awk -F': ' '/^name:/ {print $2; exit}')"
  printf '%s\n' "$project_name"
}

service_image_exists() {
  local service_name="$1"
  local project_name=""

  project_name="$(get_compose_project_name)"
  [[ -n "$project_name" ]] || return 1

  docker_cmd image inspect "${project_name}-${service_name}:latest" >/dev/null 2>&1
}

should_build_service_images() {
  if [[ "${USE_PREBUILT_IMAGES:-0}" -eq 1 ]]; then
    return 1
  fi

  if [[ "${REPO_CHANGED:-0}" -eq 1 ]]; then
    return 0
  fi

  service_image_exists backend || return 0
  service_image_exists frontend || return 0

  return 1
}

mysql_login_with_current_app_credentials() {
  compose_cmd --profile with-mysql exec -T mysql \
    sh -lc 'MYSQL_PWD="${MYSQL_PASSWORD}" mysql -u"${MYSQL_USER}" -D "${MYSQL_DATABASE}" -Nse "SELECT 1;"' >/dev/null 2>&1
}

mysql_login_with_current_root_credentials() {
  compose_cmd --profile with-mysql exec -T mysql \
    sh -lc 'MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" mysql -uroot -Nse "SELECT 1;"' >/dev/null 2>&1
}

reconcile_mysql_app_credentials() {
  compose_cmd --profile with-mysql exec -T mysql \
    sh -lc 'MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\`;
CREATE USER IF NOT EXISTS '\''${MYSQL_USER}'\''@'\''%'\'' IDENTIFIED BY '\''${MYSQL_PASSWORD}'\'';
ALTER USER '\''${MYSQL_USER}'\''@'\''%'\'' IDENTIFIED BY '\''${MYSQL_PASSWORD}'\'';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '\''${MYSQL_USER}'\''@'\''%'\'';
FLUSH PRIVILEGES;
SQL'
}

ensure_mysql_credentials() {
  local timeout_seconds="${1:-120}"
  local elapsed=0
  local did_reconcile=0

  while (( elapsed < timeout_seconds )); do
    if mysql_login_with_current_app_credentials; then
      if [[ "$did_reconcile" -eq 1 ]]; then
        log_success '已自动同步 MySQL 应用账号密码。'
      fi
      return 0
    fi

    if mysql_login_with_current_root_credentials; then
      if [[ "$did_reconcile" -eq 0 ]]; then
        log_warn '检测到 MySQL 应用账号与当前配置不一致，正在自动同步数据库账号密码。'
        did_reconcile=1
      fi
      reconcile_mysql_app_credentials
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  if mysql_login_with_current_root_credentials; then
    die "MySQL Root 凭据可用，但自动同步应用账号后仍无法登录，请执行 $(compose_cli_prefix) logs mysql 查看详细信息。"
  fi

  die '检测到现有 MySQL 数据卷中的凭据与当前配置不一致，且当前 Root 密码无法验证。为避免误删已有数据，脚本已停止。若确认可重置数据，请先备份并删除 mysql_data 卷后重试。'
}

deploy_stack() {
  cd "$REPO_DIR"
  local deploy_started_at=0
  local deploy_finished_at=0

  deploy_started_at="$(date +%s)"

  log_info '启动 MySQL 容器...'
  compose_cmd --profile with-mysql up -d mysql
  if ! wait_for_container_ready "v-save-mysql" 180; then
    die "MySQL 容器启动超时，请执行 $(compose_cli_prefix) logs mysql 查看原因。"
  fi
  ensure_mysql_credentials
  log_success 'MySQL 容器已就绪。'

  if [[ "${USE_PREBUILT_IMAGES:-0}" -eq 1 ]]; then
    log_info '检测到预构建镜像部署模式，开始拉取后端与前端镜像...'
    compose_cmd --profile with-mysql pull backend frontend
    compose_cmd --profile with-mysql up -d backend frontend
  elif should_build_service_images; then
    log_info '开始构建并启动后端与前端容器...'
    compose_cmd --profile with-mysql up -d --build backend frontend
  else
    log_info '检测到现有镜像可复用，直接启动后端与前端容器。'
    compose_cmd --profile with-mysql up -d backend frontend
  fi

  if ! wait_for_container_ready "v-save-backend" 300; then
    die "后端容器启动超时，请执行 $(compose_cli_prefix) logs backend 查看原因。"
  fi
  if ! wait_for_container_ready "v-save-frontend" 180; then
    die "前端容器启动超时，请执行 $(compose_cli_prefix) logs frontend 查看原因。"
  fi
  deploy_finished_at="$(date +%s)"
  DEPLOY_DURATION_SECONDS="$((deploy_finished_at - deploy_started_at))"
  capture_deploy_artifacts
  log_success '前后端容器已全部启动。'
}

show_summary() {
  printf '\n'
  printf '========================================\n'
  printf '        %s 部署完成\n' "$PROJECT_NAME"
  printf '========================================\n'
  printf '前端访问地址：%s\n' "$WEB_PUBLIC_ORIGIN"
  printf '后端接口地址：%s\n' "$PUBLIC_API_ORIGIN"
  printf '数据库主机端口：127.0.0.1:%s\n' "$MYSQL_PORT"
  printf '数据库名称：%s\n' "$MYSQL_DATABASE"
  printf '数据库用户名：%s\n' "$MYSQL_USER"
  printf '数据库密码：%s\n' "$MYSQL_PASSWORD"
  printf '数据库 Root 密码：%s\n' "$MYSQL_ROOT_PASSWORD"
  printf '超级管理员邮箱：%s\n' "$SUPER_ADMIN_BOOTSTRAP_EMAIL"
  if [[ "$SUPER_ADMIN_PASSWORD_GENERATED" -eq 1 ]]; then
    printf '超级管理员初始密码：%s\n' "$SUPER_ADMIN_BOOTSTRAP_PASSWORD"
    printf '提示：该密码只在首次初始化时会写入数据库，请登录后尽快修改。\n'
  else
    printf '超级管理员密码：本次未重置，已保留现有初始化配置，出于安全考虑不再明文输出。\n'
  fi
  printf '本次部署耗时：%s\n' "$(format_duration_seconds "$DEPLOY_DURATION_SECONDS" | tr -d '\n')"
  printf '后端镜像大小：%s\n' "${BACKEND_IMAGE_SIZE:-未获取}"
  printf '前端镜像大小：%s\n' "${FRONTEND_IMAGE_SIZE:-未获取}"
  printf '注册入口默认状态：关闭，可在“后台管理 -> 系统设置”中手动开启。\n'
  printf '配置文件位置：%s/.env\n' "$REPO_DIR"
  printf '\n'
  printf '如果你需要查看容器状态，请执行：cd %s && %s --profile with-mysql ps\n' "$REPO_DIR" "$(compose_cli_prefix)"
  printf '========================================\n'
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -y|--yes)
        FORCE_YES=1
        shift
        ;;
      --refresh-repo)
        FORCE_REFRESH_REPO=1
        shift
        ;;
      --use-prebuilt-images)
        USE_PREBUILT_IMAGES=1
        shift
        ;;
      --backend-image)
        PREBUILT_BACKEND_IMAGE="${2:-}"
        [[ -n "$PREBUILT_BACKEND_IMAGE" ]] || die '--backend-image 需要跟一个后端镜像名。'
        shift 2
        ;;
      --frontend-image)
        PREBUILT_FRONTEND_IMAGE="${2:-}"
        [[ -n "$PREBUILT_FRONTEND_IMAGE" ]] || die '--frontend-image 需要跟一个前端镜像名。'
        shift 2
        ;;
      --image-tag)
        PREBUILT_IMAGE_TAG="${2:-}"
        [[ -n "$PREBUILT_IMAGE_TAG" ]] || die '--image-tag 需要跟一个镜像 tag。'
        shift 2
        ;;
      --install-dir)
        USER_INSTALL_DIR="${2:-}"
        [[ -n "$USER_INSTALL_DIR" ]] || die '--install-dir 需要跟一个目录参数。'
        shift 2
        ;;
      --repo-url)
        USER_REPO_URL="${2:-}"
        [[ -n "$USER_REPO_URL" ]] || die '--repo-url 需要跟一个仓库地址。'
        shift 2
        ;;
      --public-host)
        USER_PUBLIC_HOST="${2:-}"
        [[ -n "$USER_PUBLIC_HOST" ]] || die '--public-host 需要跟一个访问域名或 IP。'
        shift 2
        ;;
      --force-region)
        FORCE_REGION="${2:-}"
        [[ -n "$FORCE_REGION" ]] || die '--force-region 需要使用 cn 或 global。'
        shift 2
        ;;
      -h|--help)
        cat <<EOF
用法：
  bash deploy.sh [选项]

可选参数：
  -y, --yes              跳过交互确认，默认自动继续
  --refresh-repo         刷新仓库代码；无 git 时会重新下载压缩包并保留现有 .env 配置
  --use-prebuilt-images  启用预构建镜像部署模式，服务器只拉取现成镜像
  --backend-image <名称> 指定后端镜像名，例如 yourname/v-save-backend
  --frontend-image <名称>指定前端镜像名，例如 yourname/v-save-frontend
  --image-tag <标签>     指定前后端镜像共用的 tag，例如 latest 或 git sha
  --install-dir <目录>   指定仓库落地目录
  --repo-url <地址>      指定仓库 Git 地址
  --public-host <地址>   指定部署完成后展示的访问域名或 IP
  --force-region <模式>  强制网络环境为 cn 或 global
  -h, --help             显示帮助
EOF
        exit 0
        ;;
      *)
        die "不支持的参数：$1"
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  local arch
  arch="$(normalize_arch "$(uname -m)")"
  log_info "检测到服务器架构：${arch}。将使用官方多架构 Docker 镜像自动适配。"

  if detect_china_mainland; then
    USE_CN_MIRROR=1
    log_info '检测到当前网络环境疑似位于中国大陆，将自动启用镜像加速。'
  else
    USE_CN_MIRROR=0
    log_info '检测到当前网络环境为全球网络，将使用默认官方源。'
  fi

  ensure_docker_environment
  configure_docker_mirror
  ensure_repo_checkout
  detect_deploy_host
  load_or_generate_env
  validate_prebuilt_image_settings
  write_env_files
  deploy_stack
  show_summary
}

if [[ "${V_SAVE_DEPLOY_SOURCE_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

main "$@"
