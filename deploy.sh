#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_BRANCH="${RELEASE_BRANCH:-main}"
NPM_CACHE="${TMPDIR:-/tmp}/zterm-deploy-npm-cache"
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

banner() { printf '\n--------- %s ---------\n' "$1"; }

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

need_cmd() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null 2>&1 || die "缺少命令：${command_name}"
  done
}

confirm() {
  local answer=""
  printf '%s' "$1"
  read -r answer || true
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

package_version() {
  node -p 'require("./package.json").version'
}

release_tag() {
  printf 'v%s' "$(package_version)"
}

repo_slug() {
  local url
  url="$(git remote get-url origin)"
  url="${url#ssh://git@github.com:}"
  url="${url#git@github.com:}"
  url="${url#https://github.com/}"
  url="${url#http://github.com/}"
  url="${url%.git}"
  printf '%s' "$url"
}

guard_main() {
  local branch
  branch="$(git branch --show-current)"
  [[ "$branch" == "$RELEASE_BRANCH" ]] || die "发布命令仅允许在 ${RELEASE_BRANCH} 分支执行（当前：${branch:-detached}）"
}

guard_tag() {
  local tag="$1"
  git tag --points-at HEAD | grep -Fxq "$tag" || die "当前 HEAD 没有 ${tag}，请先执行 ./deploy.sh release"
}

verify_and_install() {
  npm --cache "$NPM_CACHE" ci
  npm run verify
}

host_target() {
  case "$(uname -s)" in
    Darwin*) printf 'mac' ;;
    MINGW*|MSYS*|CYGWIN*) printf 'win' ;;
    Linux*) printf 'linux' ;;
    *) die "无法识别当前系统，请显式指定 build 目标（mac、win 或 linux）" ;;
  esac
}

build_target() {
  case "$1" in
    mac) npm run build:mac ;;
    win) npm run build:win ;;
    linux) npm run build:linux ;;
    *) die "不支持的 build 目标：$1（可选 mac、win、linux、all、host）" ;;
  esac
}

usage() {
  cat <<'EOF'

用法：./deploy.sh <all|release|build|publish|watch> [参数]

  release [patch|minor|major|x.y.z]
      在 main 分支交互确认版本，更新 package.json/package-lock.json，
      创建 release commit 和 v<version> tag，并推送到 origin。
      推送成功后，GitHub Actions 会自动在 macOS/Windows/Linux runner 上
      构建全部平台安装包，并创建对应的 GitHub Release。
  build [host|mac|win|linux|all]
      本地验证并构建安装包；默认按当前系统选择目标（本机是 Mac 就只出 dmg）。
  watch
      跟踪最近一次定版（v<version> tag）触发的 GitHub Actions 构建，
      构建结束后确认 Release 已发布并展示地址。
  publish
      手动兜底：将本地 builds/ 中的安装包上传到 v<version> 对应的
      GitHub Release；Release 不存在则创建，已存在则覆盖补传。
  all [版本参数]
      按 release → watch 顺序执行：定版推送后一直等到 CI 打包发布完成。

常规发版只需：./deploy.sh all
本地只想验证 Mac 安装包：./deploy.sh build

EOF
}

cmd_release() {
  banner '开始锁定版本'
  need_cmd git node npm
  guard_main
  [[ -z "$(git status --porcelain)" ]] || die '工作区存在未提交变更，请先提交或 stash'

  local current_version input next_version
  current_version="$(package_version)"
  input="${1:-}"
  if [[ -z "$input" ]]; then
    printf '当前版本：%s\n请输入版本号（patch/minor/major 或 x.y.z，回车默认 patch）：' "$current_version"
    read -r input || true
    input="${input:-patch}"
  fi

  case "$input" in
    patch|minor|major)
      local major minor patch
      [[ "$current_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "当前版本不是标准 x.y.z：${current_version}"
      major="${BASH_REMATCH[1]}"
      minor="${BASH_REMATCH[2]}"
      patch="${BASH_REMATCH[3]}"
      case "$input" in
        patch) next_version="$major.$minor.$((patch + 1))" ;;
        minor) next_version="$major.$((minor + 1)).0" ;;
        major) next_version="$((major + 1)).0.0" ;;
      esac
      ;;
    *)
      [[ "$input" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die '版本号必须是 patch、minor、major 或 x.y.z'
      next_version="$input"
      ;;
  esac

  local next_tag="v${next_version}"
  git rev-parse --verify --quiet "refs/tags/${next_tag}" >/dev/null && die "本地 tag 已存在：${next_tag}"
  confirm "确认发布 ${next_tag}（${current_version} → ${next_tag}），提交、打 tag、推送并触发 CI 全平台打包？[y/N] " || { printf '已取消\n'; exit 0; }

  npm --cache "$NPM_CACHE" version "$next_version" -m "release: %s"
  git push --atomic origin "$RELEASE_BRANCH" "$next_tag"
  banner "版本已锁定：${next_tag}"
  printf 'GitHub Actions 正在构建三平台安装包并创建 Release：\n'
  printf '  进度：%s\n' "https://github.com/$(repo_slug)/actions"
  printf '  产物：%s\n' "https://github.com/$(repo_slug)/releases/tag/${next_tag}"
  printf '可执行 ./deploy.sh watch 跟踪构建进度。\n'
}

cmd_build() {
  banner '开始验证打包'
  need_cmd node npm
  local target="${1:-${ZTERM_BUILD_TARGET:-host}}"
  verify_and_install
  rm -rf builds

  if [[ "$target" == 'host' ]]; then
    target="$(host_target)"
  fi
  if [[ "$target" == 'all' ]]; then
    build_target mac
    build_target win
    build_target linux
  else
    build_target "$target"
  fi

  banner "打包完成：$(release_tag)"
  find builds -type f \( -name '*.dmg' -o -name '*.exe' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' -o -name '*.zip' -o -name '*.tar.gz' \) -print | sort
}

cmd_publish() {
  banner '开始分发（手动兜底）'
  need_cmd git gh
  guard_main

  local tag
  tag="$(release_tag)"
  guard_tag "$tag"
  gh auth status >/dev/null 2>&1 || die '未登录 GitHub CLI，请先执行 gh auth login'

  local assets=()
  while IFS= read -r asset; do
    assets+=("$asset")
  done < <(find builds -type f \( -name '*.dmg' -o -name '*.exe' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' -o -name '*.zip' -o -name '*.tar.gz' \) -print | sort)
  ((${#assets[@]} > 0)) || die 'builds/ 中没有安装包，请先执行 ./deploy.sh build'

  printf '待上传产物：\n'
  printf '  %s\n' "${assets[@]}"
  if gh release view "$tag" >/dev/null 2>&1; then
    confirm "Release ${tag} 已存在，是否用以上产物覆盖补传？[y/N] " || { printf '已取消\n'; exit 0; }
    gh release upload "$tag" --clobber "${assets[@]}"
  else
    confirm "确认创建 GitHub Release ${tag} 并上传以上产物？[y/N] " || { printf '已取消\n'; exit 0; }
    gh release create "$tag" --verify-tag --title "$tag" --generate-notes "${assets[@]}"
  fi
  banner "${tag} 分发完成：https://github.com/$(repo_slug)/releases/tag/${tag}"
}

cmd_watch() {
  banner '跟踪 GitHub Actions 构建'
  need_cmd gh
  gh auth status >/dev/null 2>&1 || die '未登录 GitHub CLI，请先执行 gh auth login'

  local tag run_id attempt
  tag="$(release_tag)"
  run_id=""
  for attempt in {1..12}; do
    run_id="$(gh run list --workflow=release.yml --limit 15 --json databaseId,headBranch --jq ".[] | select(.headBranch == \"${tag}\") | .databaseId" | head -n 1)" || true
    [[ -n "$run_id" ]] && break
    printf '尚未发现 %s 触发的构建，5 秒后重试……\n' "$tag"
    sleep 5
  done
  [[ -n "$run_id" ]] || die "没有找到 ${tag} 触发的构建，请到 https://github.com/$(repo_slug)/actions 查看"

  gh run watch "$run_id" --exit-status || die "GitHub Actions 构建失败：https://github.com/$(repo_slug)/actions/runs/${run_id}"
  gh release view "$tag" >/dev/null 2>&1 || die "构建已结束，但未找到 Release ${tag}"
  banner "${tag} 发布完成：https://github.com/$(repo_slug)/releases/tag/${tag}"
}

cmd_all() {
  banner '一键发布：release → 等待 CI 打包发布'
  cmd_release "${1:-}"
  cmd_watch
}

case "${1:-}" in
  release) shift; cmd_release "${1:-}" ;;
  build) shift; cmd_build "${1:-}" ;;
  publish) cmd_publish ;;
  watch) cmd_watch ;;
  all) shift; cmd_all "${1:-}" ;;
  -h|--help|help|'') usage ;;
  *) usage >&2; exit 2 ;;
esac
