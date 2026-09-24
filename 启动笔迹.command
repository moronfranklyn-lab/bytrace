#!/bin/bash
# =============================================================================
#  笔迹 ByTrace · 启动器
#
#  双击这个文件即可启动。它会：
#    1. 挑一个能正常加载原生模块的 Node（避免多版本 Node 导致的启动崩溃）
#    2. 检测端口是否被占用，自动换一个可用端口
#    3. 起服务并在就绪后自动打开浏览器
#    4. 按 Ctrl+C 停止服务
# =============================================================================

cd "$(dirname "$0")" || exit 1
PROJECT_DIR="$(pwd)"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

echo ""
echo "${BOLD}${CYAN}  笔迹 ByTrace${RESET}"
echo "${DIM}  ────────────────────────────────────${RESET}"
echo ""

# ---------------------------------------------------------------------------
# 0. 前置检查
# ---------------------------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "${RED}✗ 还没安装依赖。${RESET}"
  echo ""
  echo "  请先双击 ${BOLD}安装笔迹.command${RESET}，或手动执行："
  echo "    ${DIM}cd \"$PROJECT_DIR\" && npm install${RESET}"
  echo ""
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

if [ ! -f .env.local ]; then
  if [ -f .env.local.example ]; then
    cp .env.local.example .env.local
    echo "${YELLOW}! 未找到 .env.local，已从模板生成一份。${RESET}"
    echo "${DIM}  想填 API key 请双击「填写API密钥.command」${RESET}"
    echo ""
  fi
fi

# ---------------------------------------------------------------------------
# 1. 挑一个可用的 Node
# ---------------------------------------------------------------------------
echo "${DIM}检查 Node 运行时…${RESET}"

# 找任意一个能跑脚本的 node 来做探测（探测脚本本身不依赖原生模块）
BOOTSTRAP_NODE=""
for c in "$(command -v node 2>/dev/null)" \
         "$HOME/.nvm/versions/node/"*/bin/node \
         /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  if [ -n "$c" ] && [ -x "$c" ]; then BOOTSTRAP_NODE="$c"; break; fi
done

if [ -z "$BOOTSTRAP_NODE" ]; then
  echo "${RED}✗ 找不到 Node.js${RESET}"
  echo ""
  echo "  请先安装 Node.js 22 或更高版本："
  echo "    ${DIM}brew install node${RESET}   或   ${DIM}https://nodejs.org${RESET}"
  echo ""
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

PICKED_NODE=$("$BOOTSTRAP_NODE" scripts/pick-node.mjs "$PROJECT_DIR" 2>/dev/null)

if [ -z "$PICKED_NODE" ]; then
  echo "${RED}✗ 没有找到能加载本项目原生模块的 Node${RESET}"
  echo ""
  echo "  ${YELLOW}原因${RESET}：better-sqlite3 是按某个固定的 Node ABI 编译的，"
  echo "        而当前机器上的 Node 版本与之不匹配。"
  echo ""
  echo "  ${YELLOW}两个解决办法（任选一个）${RESET}："
  echo ""
  echo "   ${BOLD}a) 用当前 Node 重新编译原生模块${RESET}"
  echo "      ${DIM}cd \"$PROJECT_DIR\" && npm rebuild better-sqlite3${RESET}"
  echo ""
  echo "   ${BOLD}b) 装一个匹配的 Node 版本${RESET}"
  echo "      ${DIM}nvm install 22 && nvm use 22${RESET}"
  echo "      ${DIM}然后重新双击本启动器${RESET}"
  echo ""
  echo "  详细体检：${DIM}npm run doctor${RESET}"
  echo ""
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

echo "${GREEN}✓${RESET} Node ${DIM}$("$PICKED_NODE" --version)${RESET}"

NODE_BIN_DIR="$(dirname "$PICKED_NODE")"
NPM_CLI="$NODE_BIN_DIR/../lib/node_modules/npm/bin/npm-cli.js"

# ---------------------------------------------------------------------------
# 2. 选一个可用端口
# ---------------------------------------------------------------------------
DESIRED_PORT="${BYTRACE_PORT:-3100}"
if [ -z "$(grep -E '^\s*BYTRACE_PORT=' .env.local 2>/dev/null)" ]; then
  DESIRED_PORT=3100
fi

port_free() {
  ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

PORT="$DESIRED_PORT"
if ! port_free "$PORT"; then
  echo "${YELLOW}! 端口 $PORT 已被占用${RESET}，正在找可用端口…"
  PORT=""
  for p in $(seq 3101 3130); do
    if port_free "$p"; then PORT="$p"; break; fi
  done
  if [ -z "$PORT" ]; then
    echo "${RED}✗ 3100-3130 都被占用了。${RESET}"
    echo "  ${DIM}先关掉一些程序，或在 .env.local 里设 BYTRACE_PORT 换个区间${RESET}"
    echo ""
    read -n 1 -s -r -p "按任意键关闭…"
    exit 1
  fi
fi

URL="http://127.0.0.1:$PORT"
echo "${GREEN}✓${RESET} 端口 ${DIM}$PORT${RESET}"
echo ""

# ---------------------------------------------------------------------------
# 3. 选择启动方式
#   装了 Electron 就开独立窗口（推荐）；否则退回浏览器模式。
# ---------------------------------------------------------------------------
export PATH="$NODE_BIN_DIR:$PATH"

ELECTRON_PATH_FILE="$PROJECT_DIR/node_modules/electron/path.txt"
HAS_ELECTRON=0
if [ -f "$ELECTRON_PATH_FILE" ]; then
  ELECTRON_EXE="$PROJECT_DIR/node_modules/electron/dist/$(cat "$ELECTRON_PATH_FILE")"
  [ -x "$ELECTRON_EXE" ] && HAS_ELECTRON=1
fi

if [ "$HAS_ELECTRON" = "1" ]; then
  echo "${BOLD}启动桌面窗口…${RESET} ${DIM}(首次启动需要编译页面，约 30-60 秒)${RESET}"
  echo ""
  echo "${DIM}  想用浏览器打开而不是独立窗口，可执行：npm run dev${RESET}"
  echo ""
  # 交给桌面外壳：它自己负责起服务、开窗口、退出时回收
  exec "$PICKED_NODE" scripts/desktop.mjs
fi

# ---------------------------------------------------------------------------
# 3b. 浏览器模式（未安装 Electron 时）
# ---------------------------------------------------------------------------
echo "${BOLD}启动中…${RESET} ${DIM}(首次启动需要编译页面，约 10-30 秒)${RESET}"
echo ""

LOG_FILE="$PROJECT_DIR/.bytrace-dev.log"
: > "$LOG_FILE"

# 关键：把选中的 Node 放到 PATH 最前面。
# 因为 npm 会以子进程方式再执行 `node scripts/dev.mjs`，
# 若不改 PATH，子进程会重新解析到 PATH 里那个（可能 ABI 不匹配的）node。
export PATH="$NODE_BIN_DIR:$PATH"

if [ -f "$NPM_CLI" ]; then
  ( cd "$PROJECT_DIR" && "$PICKED_NODE" "$NPM_CLI" run dev -- -p "$PORT" >> "$LOG_FILE" 2>&1 ) &
else
  ( cd "$PROJECT_DIR" && "$PICKED_NODE" node_modules/next/dist/bin/next dev -p "$PORT" >> "$LOG_FILE" 2>&1 ) &
fi
SERVER_PID=$!

cleanup() {
  echo ""
  echo "${DIM}正在停止服务…${RESET}"
  kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  echo "${DIM}已停止。${RESET}"
  exit 0
}
trap cleanup INT TERM

# 等待就绪
READY=0
for i in $(seq 1 90); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  if grep -q "Ready in" "$LOG_FILE" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" != "1" ]; then
  echo "${RED}✗ 启动失败${RESET}"
  echo ""
  echo "  ${YELLOW}最后几行日志：${RESET}"
  tail -12 "$LOG_FILE" 2>/dev/null | sed 's/^/    /'
  echo ""
  echo "  ${DIM}完整日志：$LOG_FILE${RESET}"
  echo "  ${DIM}也可以跑 npm run doctor 做体检${RESET}"
  echo ""
  read -n 1 -s -r -p "按任意键关闭…"
  cleanup
fi

echo "${GREEN}✓ 已就绪${RESET}"
echo ""
echo "${BOLD}  在浏览器打开：${CYAN}$URL${RESET}"
echo ""
echo "${DIM}  · 服务运行中，保持这个窗口不要关${RESET}"
echo "${DIM}  · 按 Ctrl+C 停止${RESET}"
echo "${DIM}  · 日志：$LOG_FILE${RESET}"
echo ""

open "$URL" 2>/dev/null || true

# 健康自检提示
sleep 2
HEALTH=$(curl -s --max-time 5 "$URL/api/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "${GREEN}✓ 自检通过：主 Agent 与数据库均就绪${RESET}"
elif [ -n "$HEALTH" ]; then
  echo "${YELLOW}! 自检提示有项目未就绪，打开页面后按提示处理：${RESET}"
  echo "  ${DIM}$URL/api/health${RESET}"
else
  echo "${DIM}（未能自动完成自检，可在浏览器访问 $URL/api/health 查看）${RESET}"
fi

echo ""
echo "${DIM}────────────────────────────────────${RESET}"

wait "$SERVER_PID"
