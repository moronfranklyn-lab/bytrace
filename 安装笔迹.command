#!/bin/bash
# =============================================================================
#  笔迹 ByTrace · 一键安装
#
#  双击这个文件即可完成安装。它会：
#    1. 检查 Node.js 版本
#    2. 安装依赖（含原生模块编译）
#    3. 生成配置文件（若不存在）
#    4. 体检并报告结果
#    5. 可选：安装桌面启动图标
# =============================================================================

cd "$(dirname "$0")" || exit 1
PROJECT_DIR="$(pwd)"

# 强制 UTF-8，避免中文文件名在部分终端下触发 sed/grep 的字节序列错误
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"
APP_NAME="笔迹 ByTrace"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

echo ""
echo "${BOLD}${CYAN}  笔迹 ByTrace · 安装${RESET}"
echo "${DIM}  ────────────────────────────────────${RESET}"
echo ""

step() { echo "${BOLD}$1${RESET}"; }
ok()   { echo "${GREEN}✓${RESET} $1"; }
warn() { echo "${YELLOW}!${RESET} $1"; }
fail() { echo "${RED}✗${RESET} $1"; }

pause_exit() {
  echo ""
  read -n 1 -s -r -p "按任意键关闭…"
  exit "${1:-0}"
}

# ---------------------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------------------
step "1/5  检查 Node.js"

BOOTSTRAP_NODE=""
for c in "$(command -v node 2>/dev/null)" \
         "$HOME/.nvm/versions/node/"*/bin/node \
         /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if [ -n "$c" ] && [ -x "$c" ]; then BOOTSTRAP_NODE="$c"; break; fi
done

if [ -z "$BOOTSTRAP_NODE" ]; then
  fail "找不到 Node.js"
  echo ""
  echo "  请先安装 Node.js 22 或更高版本，二选一："
  echo "    ${BOLD}a)${RESET} 官网下载安装包：${CYAN}https://nodejs.org${RESET}"
  echo "    ${BOLD}b)${RESET} 用 Homebrew：${DIM}brew install node${RESET}"
  echo ""
  echo "  装好后重新双击本文件。"
  pause_exit 1
fi

NODE_VERSION="$("$BOOTSTRAP_NODE" --version)"
NODE_MAJOR="$(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1)"

if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node.js 版本过低：$NODE_VERSION（需要 22 或更高）"
  echo ""
  echo "  升级办法（二选一）："
  echo "    ${BOLD}a)${RESET} 官网下载最新 LTS：${CYAN}https://nodejs.org${RESET}"
  echo "    ${BOLD}b)${RESET} 用 nvm：${DIM}nvm install 22 && nvm use 22${RESET}"
  pause_exit 1
fi

ok "Node.js $NODE_VERSION"

# ---------------------------------------------------------------------------
# 2. 安装依赖
# ---------------------------------------------------------------------------
step "2/5  安装依赖"

NODE_BIN_DIR="$(dirname "$BOOTSTRAP_NODE")"
NPM_CLI="$NODE_BIN_DIR/../lib/node_modules/npm/bin/npm-cli.js"

run_npm() {
  if [ -f "$NPM_CLI" ]; then
    "$BOOTSTRAP_NODE" "$NPM_CLI" "$@"
  else
    PATH="$NODE_BIN_DIR:$PATH" npm "$@"
  fi
}

if [ -d node_modules ] && [ -f node_modules/better-sqlite3/package.json ]; then
  ok "依赖已存在，跳过安装"
  echo "${DIM}  如需重装，先删除 node_modules 目录${RESET}"
else
  echo "${DIM}  正在安装（better-sqlite3 是原生模块，首次需要几分钟编译）…${RESET}"
  echo ""
  if ! run_npm install; then
    echo ""
    fail "依赖安装失败"
    echo ""
    echo "  常见原因与处理："
    echo "    ${BOLD}·${RESET} 网络问题 —— 换网络重试，或配置 npm 镜像："
    echo "      ${DIM}npm config set registry https://registry.npmmirror.com${RESET}"
    echo "    ${BOLD}·${RESET} 缺少编译工具链 —— 安装 Xcode 命令行工具："
    echo "      ${DIM}xcode-select --install${RESET}"
    pause_exit 1
  fi
  ok "依赖安装完成"
fi

# ---------------------------------------------------------------------------
# 3. 配置文件
# ---------------------------------------------------------------------------
step "3/5  准备配置文件"

if [ -f .env.local ]; then
  ok ".env.local 已存在（不会覆盖）"
elif [ -f .env.local.example ]; then
  cp .env.local.example .env.local
  ok "已从模板生成 .env.local"
  warn "还没填 API key —— 双击「填写API密钥.command」可以填写"
  echo "${DIM}  不填也能启动：会自动回退到本机 CLI 订阅${RESET}"
else
  warn "找不到 .env.local.example，跳过"
fi

# ---------------------------------------------------------------------------
# 4. 体检
# ---------------------------------------------------------------------------
step "4/5  环境体检"
echo ""

# 用「能加载原生模块」的那个 Node 来体检，否则会把 ABI 不匹配误报成问题
DOCTOR_NODE="$BOOTSTRAP_NODE"
if [ -f scripts/pick-node.mjs ]; then
  PICKED="$("$BOOTSTRAP_NODE" scripts/pick-node.mjs "$PROJECT_DIR" 2>/dev/null)"
  if [ -n "$PICKED" ]; then
    DOCTOR_NODE="$PICKED"
    if [ "$PICKED" != "$BOOTSTRAP_NODE" ]; then
      echo "${DIM}  注意：为匹配原生模块，体检改用 $("$PICKED" --version) 执行${RESET}"
      echo ""
    fi
  fi
fi

"$DOCTOR_NODE" scripts/doctor.mjs
DOCTOR_EXIT=$?
echo ""

# ---------------------------------------------------------------------------
# 5. 桌面启动图标
# ---------------------------------------------------------------------------
step "5/5  启动图标"

# 先生成应用图标（需要 Python3 + Pillow；缺了就跳过，用系统默认图标，不阻断安装）
if [ -f scripts/make-icns.py ]; then
  if command -v python3 >/dev/null 2>&1 && python3 -c "import PIL" >/dev/null 2>&1; then
    if python3 scripts/make-icns.py >/dev/null 2>&1 && [ -f build/AppIcon.icns ]; then
      ok "应用图标已生成"
    else
      warn "图标生成失败，将使用系统默认图标（不影响使用）"
    fi
  else
    warn "缺少 Python3 或 Pillow，跳过图标生成（不影响使用）"
    echo "${DIM}  需要图标时执行：pip3 install Pillow && python3 scripts/make-icns.py${RESET}"
  fi
fi

# 用 Node 脚本生成 .app 包（内含 plist 与启动脚本，避免 shell 引号转义问题）
APP_SRC="$PROJECT_DIR/dist/$APP_NAME.app"
if "$BOOTSTRAP_NODE" scripts/make-app.mjs "$PROJECT_DIR/dist" >/dev/null 2>&1; then
  ok "已生成启动图标"
else
  warn "启动图标生成失败（不影响使用）"
fi

# 尝试装到桌面 / 应用程序目录
INSTALLED=""
for target_dir in "$HOME/Desktop" "$HOME/Applications"; do
  if [ -d "$target_dir" ]; then
    if cp -R "$APP_SRC" "$target_dir/" 2>/dev/null; then
      INSTALLED="$target_dir/$APP_NAME.app"
      break
    fi
  fi
done

if [ -n "$INSTALLED" ]; then
  ok "启动图标已安装到：$INSTALLED"
  echo "${DIM}  可以把它拖进程序坞，以后一键启动${RESET}"
else
  warn "没能写入桌面/应用程序目录（可能是系统权限限制）"
  echo "${DIM}  不影响使用。图标已放在项目内：${RESET}"
  echo "${DIM}    $APP_SRC${RESET}"
  echo "${DIM}  手动把它拖到桌面或应用程序文件夹即可。${RESET}"
fi

# ---------------------------------------------------------------------------
# 完成
# ---------------------------------------------------------------------------
echo ""
echo "${GREEN}${BOLD}  安装完成${RESET}"
echo ""
echo "  下一步："
echo "    ${BOLD}1.${RESET} 双击 ${CYAN}填写API密钥.command${RESET} 填上你的模型 API key"
echo "       ${DIM}（不填也能用，会回退到本机 CLI 订阅）${RESET}"
echo "    ${BOLD}2.${RESET} 双击 ${CYAN}启动笔迹.command${RESET} 开始使用"
echo "       ${DIM}（或双击桌面上的「$APP_NAME」图标）${RESET}"
echo ""

if [ "$DOCTOR_EXIT" != "0" ]; then
  echo "${YELLOW}  注意：体检发现有问题，请按上面的提示先处理，否则可能启动失败。${RESET}"
  echo ""
fi

pause_exit 0
