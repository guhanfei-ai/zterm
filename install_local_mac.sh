#!/usr/bin/env bash
#
# install_local_mac.sh — 本机 macOS 本地安装脚本
#
# 功能：构建并安装最新版 zTerm 到 /Applications，保留全部用户数据。
# 可重复运行，幂等安全。
#
# 用法：
#   ./install_local_mac.sh          # 构建 + 安装
#   ./install_local_mac.sh --skip-build  # 跳过构建，直接用 builds/ 中现有 dmg 安装
#
set -Eeuo pipefail

# ================================================================
# 常量
# ================================================================
APP_NAME="zTerm"
APP_BUNDLE="${APP_NAME}.app"
INSTALL_DIR="/Applications"
TARGET_APP="${INSTALL_DIR}/${APP_BUNDLE}"

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILDS_DIR="${ROOT_DIR}/builds"

# 用户数据目录（这些目录不会被触碰）
DATA_DIRS=(
  "$HOME/.zterm"
  "$HOME/Library/Application Support/zTerm"
  "$HOME/Library/Preferences/com.zterm.app.plist"
  "$HOME/Library/Caches/com.zterm.app"
)

# ================================================================
# 工具函数
# ================================================================
banner() { printf '\n========= %s =========\n' "$1"; }
info()   { printf '>>> %s\n' "$1"; }
warn()   { printf 'WARN: %s\n' "$1" >&2; }
die()    { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

need_cmd() {
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "缺少命令：${cmd}"
  done
}

# ================================================================
# 前置检查
# ================================================================
preflight() {
  banner '前置检查'
  need_cmd node npm

  # 必须在 macOS 上运行
  [[ "$(uname -s)" == Darwin* ]] || die "此脚本仅支持 macOS"

  # 必须在项目根目录执行
  [[ -f "${ROOT_DIR}/package.json" ]] || die "未找到 package.json，请在项目根目录执行"

  info "项目目录：${ROOT_DIR}"
  info "当前版本：$(node -p 'require("./package.json").version')"
}

# ================================================================
# 关闭正在运行的 zTerm
# ================================================================
quit_app() {
  if pgrep -xq "${APP_NAME}" 2>/dev/null || pgrep -f "zTerm.app" 2>/dev/null; then
    info '检测到 zTerm 正在运行，正在关闭……'
    osascript -e 'tell application "zTerm" to quit' 2>/dev/null || true
    # 等待进程退出，最多 10 秒
    local waited=0
    while pgrep -xq "${APP_NAME}" 2>/dev/null && [[ $waited -lt 10 ]]; do
      sleep 1
      waited=$((waited + 1))
    done
    if pgrep -xq "${APP_NAME}" 2>/dev/null; then
      warn 'zTerm 未响应退出信号，强制终止……'
      pkill -9 -x "${APP_NAME}" 2>/dev/null || true
      sleep 1
    fi
    info 'zTerm 已关闭'
  else
    info 'zTerm 未在运行'
  fi
}

# ================================================================
# 确认用户数据安全
# ================================================================
verify_data_safe() {
  banner '用户数据安全确认'
  local found_any=false
  for dir in "${DATA_DIRS[@]}"; do
    if [[ -e "$dir" ]]; then
      info "数据目录存在：${dir}"
      found_any=true
    fi
  done
  if [[ "$found_any" == false ]]; then
    info '未发现已有用户数据（首次安装，无数据需要保护）'
  else
    info '以上数据目录不会被修改或删除'
  fi
}

# ================================================================
# 构建
# ================================================================
do_build() {
  banner '构建安装包'
  cd "$ROOT_DIR"

  info '安装依赖……'
  npm ci

  info '清理旧构建产物……'
  rm -rf builds

  info '执行 electron-vite build + electron-builder……'
  npm run build:mac

  # 找到生成的 dmg，设置全局变量
  DMG_FILE="$(find "$BUILDS_DIR" -maxdepth 1 -name '*.dmg' -type f | sort | tail -n 1)"
  [[ -n "$DMG_FILE" ]] || die '构建完成但未找到 .dmg 文件'

  info "构建产物：${DMG_FILE}"
}

# ================================================================
# 安装（从 dmg 挂载并拷贝 .app）
# ================================================================
do_install() {
  local dmg_file="$1"

  banner '安装到 /Applications'

  # 如果旧 .app 存在，先移除
  if [[ -d "$TARGET_APP" ]]; then
    info "移除旧版 ${TARGET_APP} ……"
    rm -rf "$TARGET_APP"
  fi

  # 挂载 dmg
  local mount_point
  mount_point="$(mktemp -d /tmp/zterm-dmg-mount.XXXXXX)"
  info "挂载 dmg 到 ${mount_point} ……"

  hdiutil attach "$dmg_file" -nobrowse -readonly -mountpoint "$mount_point" >/dev/null 2>&1 \
    || die "挂载 dmg 失败：${dmg_file}"

  # 找到 .app
  local app_in_dmg
  app_in_dmg="$(find "$mount_point" -maxdepth 1 -name '*.app' -type d | head -n 1)"
  if [[ -z "$app_in_dmg" ]]; then
    hdiutil detach "$mount_point" -force >/dev/null 2>&1 || true
    die 'dmg 中未找到 .app'
  fi

  info "拷贝 ${APP_BUNDLE} 到 ${INSTALL_DIR} ……"
  cp -R "$app_in_dmg" "$TARGET_APP"

  # 卸载 dmg
  info '卸载 dmg ……'
  hdiutil detach "$mount_point" -force >/dev/null 2>&1 || warn '卸载 dmg 失败，可稍后手动弹出'

  info "安装完成：${TARGET_APP}"
}

# ================================================================
# 清除 macOS 隔离标记（避免"无法验证开发者"弹窗）
# ================================================================
clear_quarantine() {
  if [[ -d "$TARGET_APP" ]]; then
    info '清除 quarantine 属性……'
    xattr -rd com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
  fi
}

# ================================================================
# 验证安装结果
# ================================================================
verify_install() {
  banner '验证安装'
  if [[ -d "$TARGET_APP" ]]; then
    info "✓ ${TARGET_APP} 已就位"
  else
    die "安装失败：${TARGET_APP} 不存在"
  fi

  # 确认数据目录未被破坏
  for dir in "${DATA_DIRS[@]}"; do
    if [[ -e "$dir" ]]; then
      info "✓ 数据目录完好：${dir}"
    fi
  done

  local installed_version
  installed_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${TARGET_APP}/Contents/Info.plist" 2>/dev/null || echo '未知')"
  info "已安装版本：${installed_version}"
}

# ================================================================
# 主流程
# ================================================================
main() {
  local skip_build=false
  if [[ "${1:-}" == "--skip-build" ]]; then
    skip_build=true
  fi

  banner 'zTerm 本机安装（macOS）'
  info '此脚本不会修改或刪除任何用户数据'

  preflight
  verify_data_safe
  quit_app

  DMG_FILE=""
  if [[ "$skip_build" == true ]]; then
    info '跳过构建，使用 builds/ 中现有 dmg ……'
    DMG_FILE="$(find "$BUILDS_DIR" -maxdepth 1 -name '*.dmg' -type f | sort | tail -n 1)"
    [[ -n "$DMG_FILE" ]] || die 'builds/ 中未找到 .dmg 文件，请先执行不带 --skip-build 的安装'
    info "使用：${DMG_FILE}"
  else
    do_build
  fi

  do_install "$DMG_FILE"
  clear_quarantine
  verify_install

  banner '安装完成'
  info "可从 Launchpad 或 /Applications 启动 zTerm"
  info "用户数据目录 ~/.zterm/ 未受影响"
}

main "$@"
