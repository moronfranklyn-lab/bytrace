#!/bin/bash
# =============================================================================
#  笔迹 ByTrace · 安装桌面图标
#
#  如果「安装笔迹.command」里那一步没成功、或你在 Finder 里找不到图标，
#  双击这个文件。它会逐个尝试可写的目标位置，并明确告诉你结果。
# =============================================================================

cd "$(dirname "$0")" || exit 1
PROJECT_DIR="$(pwd)"
APP_NAME="笔迹 ByTrace"

export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

echo ""
echo "${BOLD}${CYAN}  笔迹 ByTrace · 安装桌面图标${RESET}"
echo "${DIM}  ────────────────────────────────────${RESET}"
echo ""

# ---------------------------------------------------------------------------
# 0. 找一个能用的 Node
# ---------------------------------------------------------------------------
BOOTSTRAP_NODE=""
for c in "$(command -v node 2>/dev/null)" \
         "$HOME/.nvm/versions/node/"*/bin/node \
         /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if [ -n "$c" ] && [ -x "$c" ]; then BOOTSTRAP_NODE="$c"; break; fi
done

if [ -z "$BOOTSTRAP_NODE" ]; then
  echo "${RED}✗ 找不到 Node.js，无法生成图标包${RESET}"
  echo ""
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. 生成图标包
# ---------------------------------------------------------------------------
APP_SRC="$PROJECT_DIR/dist/$APP_NAME.app"

echo "${DIM}生成图标包…${RESET}"
mkdir -p "$PROJECT_DIR/dist"

if ! "$BOOTSTRAP_NODE" scripts/make-app.mjs "$PROJECT_DIR/dist"; then
  echo "${RED}✗ 生成失败${RESET}"
  echo ""
  echo "  请把下面这行命令的输出发给开发者："
  echo "  ${DIM}node scripts/make-app.mjs \"$PROJECT_DIR/dist\"${RESET}"
  echo ""
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

if [ ! -d "$APP_SRC" ]; then
  echo "${RED}✗ 生成后仍找不到：$APP_SRC${RESET}"
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

echo "${GREEN}✓${RESET} 已生成：${DIM}$APP_SRC${RESET}"
echo ""

# ---------------------------------------------------------------------------
# 2. 逐个尝试可写的目标位置
# ---------------------------------------------------------------------------
echo "${BOLD}尝试安装到：${RESET}"
echo ""

INSTALLED_TO=""
FAILED_REASONS=""

try_target() {
  local dir="$1"
  local label="$2"

  if [ ! -d "$dir" ]; then
    echo "  ${DIM}·${RESET} $label —— 目录不存在，跳过"
    return
  fi

  if [ -d "$dir/$APP_NAME.app" ]; then
    echo "  ${GREEN}✓${RESET} $label —— 已存在"
    INSTALLED_TO="$dir/$APP_NAME.app"
    return
  fi

  # 先探测是否可写，避免 cp 之后才发现
  if [ ! -w "$dir" ]; then
    echo "  ${YELLOW}!${RESET} $label —— 没有写入权限"
    FAILED_REASONS="$FAILED_REASONS\n    · $label：没有写入权限（macOS 隐私保护可能限制了对该目录的访问）"
    return
  fi

  local err
  err=$(cp -R "$APP_SRC" "$dir/" 2>&1)
  if [ $? -eq 0 ] && [ -d "$dir/$APP_NAME.app" ]; then
    echo "  ${GREEN}✓${RESET} $label —— 安装成功"
    INSTALLED_TO="$dir/$APP_NAME.app"
  else
    echo "  ${RED}✗${RESET} $label —— 复制失败"
    [ -n "$err" ] && echo "      ${DIM}${err}${RESET}"
    FAILED_REASONS="$FAILED_REASONS\n    · $label：${err:-复制被拒绝}"
  fi
}

try_target "$HOME/Desktop"               "桌面"
try_target "$HOME/Applications"          "用户应用程序目录"
try_target "/Applications"               "系统应用程序目录"

echo ""

# ---------------------------------------------------------------------------
# 3. 结果
# ---------------------------------------------------------------------------
if [ -n "$INSTALLED_TO" ]; then
  echo "${GREEN}${BOLD}安装成功${RESET}"
  echo ""
  echo "  图标位置：${CYAN}$INSTALLED_TO${RESET}"
  echo ""
  echo "  ${BOLD}如果桌面上看不到它：${RESET}"
  echo "    · 桌面可能开了「叠放」，去 ${DIM}访达 → 显示 → 取消叠放${RESET}"
  echo "    · 图标名字是「${BOLD}$APP_NAME${RESET}」，在桌面上找一下"
  echo ""
  echo "  ${BOLD}想放进程序坞：${RESET}"
  echo "    把它拖到程序坞左侧区域即可"
  echo ""
  echo "  ${DIM}首次双击若提示来自身份不明的开发者：右键 → 打开 → 再点打开${RESET}"
else
  echo "${YELLOW}${BOLD}没能自动安装${RESET}"
  echo ""
  echo "  三个位置都写不进去，通常是 macOS 的隐私保护在拦截。"
  echo -e "$FAILED_REASONS"
  echo ""
  echo "  ${BOLD}手动安装（一定能成）：${RESET}"
  echo ""
  echo "   1. 打开访达，按 ${BOLD}Cmd+Shift+G${RESET}"
  echo "   2. 粘贴这个路径，回车："
  echo "      ${CYAN}$PROJECT_DIR/dist${RESET}"
  echo "   3. 把里面的「${BOLD}$APP_NAME.app${RESET}」拖到桌面或「应用程序」"
  echo ""
  echo "  ${DIM}（如果拖的时候提示权限不足，去「系统设置 → 隐私与安全性 →${RESET}"
  echo "  ${DIM}   完全磁盘访问权限」，把「访达」或「终端」加进去再试）${RESET}"
  echo ""
  echo "  ${BOLD}其实不装图标也不影响使用：${RESET}"
  echo "    直接双击项目里的 ${CYAN}启动笔迹.command${RESET} 一样能开应用。"
fi

echo ""
read -n 1 -s -r -p "按任意键关闭…"
