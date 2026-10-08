#!/bin/bash
# Local test installation; no sudo, downloads, or system-wide Gatekeeper changes.
set -euo pipefail
cd "$(dirname "$0")"
source_app="$PWD/TierFlow.app"
target_dir="$HOME/Applications"
target_app="$target_dir/TierFlow.app"
stage_dir=''
backup_app=''
on_error() {
  printf '\n安装没有完成。请保留此窗口中的错误信息，按回车关闭。\n'
  read -r _ || true
}
trap on_error ERR
printf '\nTierFlow macOS 测试版安装\n\n'
printf '将安装到：%s\n配置保存在：%s\n\n' "$target_app" "$HOME/Library/Application Support/TierFlow"
if [[ ! -d "$source_app" || ! -f "$PWD/entitlements.mac.plist" ]]; then
  printf '请先完整解压 ZIP，并将安装脚本与 TierFlow.app 保留在同一目录。\n'; exit 1
fi
if /usr/bin/pgrep -x TierFlow >/dev/null; then
  printf '请先在菜单栏选择「退出 TierFlow」，然后重新运行安装脚本。\n'; read -r _; exit 1
fi
minimum_os=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$source_app/Contents/Info.plist")
current_os=$(/usr/bin/sw_vers -productVersion)
if (( ${current_os%%.*} < ${minimum_os%%.*} )); then
  printf '本版本需要 macOS %s 或更新系统；当前系统为 %s。\n' "$minimum_os" "$current_os"; read -r _; exit 1
fi
# file(1) ships with macOS; unlike lipo it does not need Xcode command-line tools.
app_arch=$(/usr/bin/file -b "$source_app/Contents/MacOS/TierFlow")
if [[ "$app_arch" == *'arm64'* && "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" != '1' ]]; then
  printf '这是 Apple 芯片版，请为 Intel Mac 下载 x64 测试包。\n'; read -r _; exit 1
fi
if [[ "$app_arch" == *'x86_64'* && "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" == '1' ]]; then
  printf '这台 Mac 使用 Apple 芯片，请下载 arm64 测试包，无需安装 Rosetta。\n'; read -r _; exit 1
fi
mkdir -p "$target_dir"
# Prepare and verify in a fresh directory before touching an existing install.
stage_dir=$(/usr/bin/mktemp -d "$target_dir/.tierflow-install.XXXXXX")
/usr/bin/ditto "$source_app" "$stage_dir/TierFlow.app"
printf '正在生成本机测试签名……\n'
/usr/bin/codesign --force --deep --sign - --entitlements "$PWD/entitlements.mac.plist" "$stage_dir/TierFlow.app"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$stage_dir/TierFlow.app"
if [[ -e "$target_app" ]]; then
  installed_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$target_app/Contents/Info.plist" 2>/dev/null || true)
  if [[ "$installed_id" != 'cn.tierflow.desktop' ]]; then
    printf '目标位置已有其他应用，未覆盖：%s\n' "$target_app"; read -r _; exit 1
  fi
  backup_app="$target_dir/TierFlow-backup-$(date +%Y%m%d-%H%M%S)-$$.app"
  mv "$target_app" "$backup_app"
fi
if ! mv "$stage_dir/TierFlow.app" "$target_app"; then
  if [[ -n "$backup_app" && ! -e "$target_app" ]]; then mv "$backup_app" "$target_app"; fi
  on_error; exit 1
fi
rmdir "$stage_dir"
printf '\n安装完成。后续从访达的个人「应用程序」文件夹打开 TierFlow。\n'
printf '这是未公证的测试版。如被 macOS 拦截，请在「系统设置 → 隐私与安全性」选择「仍要打开」。\n'
printf '首次读取密钥时，macOS 可能提示访问登录钥匙串，请核对应用名 TierFlow。\n'
if [[ -n "$backup_app" ]]; then printf '旧应用已备份到：%s\n' "$backup_app"; fi
/usr/bin/open -R "$target_app"
/usr/bin/open "$target_app" || true
printf '\n按回车关闭安装窗口。\n'; read -r _ || true
