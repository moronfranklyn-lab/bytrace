/**
 * lib/images/classify.ts
 * ------------------------------------------------------------
 * 用本机 Claude CLI 的视觉能力给本地配图真打标——区别于 scanner.ts 的
 * 启发式（只靠文件名/文件夹猜）。scanner 给 visual_style 猜个"其他"，
 * 这里让 Claude 真看图，分出 截图/插画/数据图/照片/其他 + 抽 4-6 个内容标签。
 *
 * 为什么不用 streamClaude（lib/claude.ts）：
 *   streamClaude 是纯文本 stream-json 通道，不挂工具，喂不进图片。视觉分类必须让
 *   CLI 用 Read 工具去磁盘读图——所以这里单独 spawn 一次 `claude -p ... --allowedTools Read`，
 *   是一次性短任务（输出一行 JSON），不需要流式。
 *
 * 铁律对齐：走本机订阅 CLI，不接 Anthropic API、不带 key（与 lib/claude.ts / lib/codex.ts 同）。
 *
 * fail-open：任何一步失败（spawn 挂 / 超时 / JSON 解析不出）都返回 null，
 *   调用方保留 scanner 的启发式打标，不阻塞、不污染。
 */

import { spawn } from 'node:child_process';
import { getDb } from '@/lib/db';
import { envStr, CLAUDE_BIN_KEYS } from '@/lib/env';

/** 与 scanner.guessVisualStyle 同一套枚举，多加"照片"（启发式分不出但真看图能分）。 */
export const VISUAL_STYLES = ['截图', '插画', '数据图', '照片', '其他'] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

export interface ClassifyResult {
  visual_style: VisualStyle;
  tags: string[];
}

const CLASSIFY_TIMEOUT_MS = 90_000; // 单图看图 + 出 JSON，留足余量
// 复用 lib/claude.ts 的候选推导（BYTRACE_CLAUDE_BIN / PATH / $HOME 常见位置），避免各处硬编码
const CLAUDE_BIN = envStr(...CLAUDE_BIN_KEYS) || 'claude';

function buildClassifyPrompt(imagePath: string): string {
  return [
    `用 Read 工具查看这张图片：${imagePath}`,
    '',
    '然后判断它的视觉风格，并抽取 4-6 个描述画面内容的中文标签（具体物件/场景/主题，别用抽象词）。',
    '',
    'visual_style 只能从这五个里选一个：截图 / 插画 / 数据图 / 照片 / 其他',
    '- 截图：软件界面、网页、聊天记录、代码',
    '- 插画：AI 生成图、手绘、卡通、海报设计',
    '- 数据图：图表、表格、信息图、流程图',
    '- 照片：真实拍摄的人/物/场景',
    '- 其他：以上都不是',
    '',
    '只输出一行 JSON，不要任何解释、不要 markdown 代码块包裹：',
    '{"visual_style":"插画","tags":["标签1","标签2","标签3","标签4"]}',
  ].join('\n');
}

/**
 * 从 Claude 的自由文本输出里抠出那一行 JSON。模型偶尔会包 ```json 或加一句话，
 * 所以用"第一个 { 到匹配的 }"的方式宽容解析。
 */
function parseClassifyOutput(raw: string): ClassifyResult | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const styleRaw = typeof obj.visual_style === 'string' ? obj.visual_style.trim() : '';
  const visual_style: VisualStyle = (VISUAL_STYLES as readonly string[]).includes(styleRaw)
    ? (styleRaw as VisualStyle)
    : '其他';

  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return { visual_style, tags };
}

/**
 * 给一张图跑 Claude 视觉分类。失败一律返 null（fail-open）。
 * @param imagePath 绝对路径
 * @param addDir    传给 --add-dir 的可读根目录（默认图片所在根，让 Read 工具能访问）
 */
export function classifyImageWithClaude(
  imagePath: string,
  opts: { addDir?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ClassifyResult | null> {
  const addDir = opts.addDir ?? imagePath.replace(/\/[^/]*$/, '');
  const timeoutMs = opts.timeoutMs ?? CLASSIFY_TIMEOUT_MS;

  return new Promise((resolve) => {
    const args = [
      '-p',
      buildClassifyPrompt(imagePath),
      '--allowedTools',
      'Read',
      '--add-dir',
      addDir,
    ];

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(CLAUDE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }

    let stdout = '';
    let settled = false;
    const finish = (val: ClassifyResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      resolve(val);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    if (opts.signal) {
      if (opts.signal.aborted) {
        finish(null);
        return;
      }
      opts.signal.addEventListener('abort', () => finish(null), { once: true });
    }

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(parseClassifyOutput(stdout));
    });
  });
}

/**
 * 把分类结果写回 local_assets：覆盖 visual_style，把新标签并入 tags_json（去重），
 * 并把 ai_tagged 置 1（标记已经过真视觉分类）。
 */
export function updateLocalAssetClassification(
  id: string,
  result: ClassifyResult,
): void {
  const db = getDb();
  const row = db
    .prepare('SELECT tags_json FROM local_assets WHERE id = ?')
    .get(id) as { tags_json: string | null } | undefined;
  if (!row) return;

  let existing: string[] = [];
  if (row.tags_json) {
    try {
      const parsed = JSON.parse(row.tags_json);
      if (Array.isArray(parsed)) {
        existing = parsed.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      // ignore malformed
    }
  }

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const t of [...existing, ...result.tags]) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }

  db.prepare(
    `UPDATE local_assets SET visual_style = ?, tags_json = ?, ai_tagged = 1 WHERE id = ?`,
  ).run(result.visual_style, JSON.stringify(merged), id);
}
