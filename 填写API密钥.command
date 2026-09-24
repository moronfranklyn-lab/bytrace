#!/bin/bash
# =============================================================================
#  笔迹 ByTrace · 填 API 密钥
#
#  双击这个文件，会用「文本编辑」打开配置文件，你填两个 key 就行。
# =============================================================================

cd "$(dirname "$0")" || exit 1

ENV_FILE=".env.local"
EXAMPLE=".env.local.example"

echo "=============================================="
echo "  笔迹 ByTrace · 配置 API 密钥"
echo "=============================================="
echo ""

# 文件不存在就从模板生成一份
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$EXAMPLE" ]; then
    cp "$EXAMPLE" "$ENV_FILE"
    echo "已从模板生成 .env.local"
  else
    echo "❌ 找不到 $EXAMPLE，请确认你双击的是项目文件夹里的这个脚本。"
    echo ""
    read -n 1 -s -r -p "按任意键关闭…"
    exit 1
  fi
fi

# 顺手备份一次（避免手滑改坏）
cp "$ENV_FILE" "$ENV_FILE.backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null

echo "配置文件：$(pwd)/$ENV_FILE"
echo ""
echo "下面两行是你要填的（找到 ★ 标记那两处）："
echo ""
grep -n "BYTRACE_AGENT_API_KEY=\|BYTRACE_SEARCH_API_KEY=" "$ENV_FILE" | sed 's/^/  第 /; s/:/ 行  /'
echo ""
echo "----------------------------------------------"
echo "  ① BYTRACE_AGENT_API_KEY   = MiMo 的 key"
echo "     申请： https://platform.xiaomimimo.com"
echo ""
echo "  ② BYTRACE_SEARCH_API_KEY  = 火山方舟（豆包）的 key"
echo "     申请： https://console.volcengine.com/ark"
echo "     另外要去方舟控制台开通「联网内容插件」："
echo "     服务组件库 → 联网内容插件 → 开通（免费开通，按次计费）"
echo "----------------------------------------------"
echo ""
echo "现在用「文本编辑」打开这个文件，填好 Cmd+S 保存即可。"
echo ""

# 用文本编辑打开（隐藏文件也能打开）
open -e "$ENV_FILE"

echo "已打开。填完保存后，回到这里按任意键可以做一次自检。"
echo ""
read -n 1 -s -r -p "按任意键开始自检（或直接关掉这个窗口跳过）…"
echo ""
echo ""

# 检测是否填了
AGENT_KEY=$(grep "^BYTRACE_AGENT_API_KEY=" "$ENV_FILE" | head -1 | cut -d= -f2-)
SEARCH_KEY=$(grep "^BYTRACE_SEARCH_API_KEY=" "$ENV_FILE" | head -1 | cut -d= -f2-)

if [ -z "$AGENT_KEY" ] && [ -z "$SEARCH_KEY" ]; then
  echo "⚠️  两个 key 都还是空的。填完再双击一次这个文件就行。"
elif [ -z "$AGENT_KEY" ]; then
  echo "⚠️  MiMo key 还是空的（BYTRACE_AGENT_API_KEY）"
elif [ -z "$SEARCH_KEY" ]; then
  echo "⚠️  火山方舟 key 还是空的（BYTRACE_SEARCH_API_KEY）—— 只填了 MiMo 也能写作，"
  echo "    只是联网事实搜索会回落到免 key 的 DuckDuckGo。"
else
  echo "✅ 两个 key 都填好了。"
fi

echo ""
echo "接下来双击「启动笔迹.command」就能用了。"
echo ""
read -n 1 -s -r -p "按任意键关闭…"
