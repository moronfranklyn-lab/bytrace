/**
 * 博主指纹 v3 提炼引擎。被 POST /api/fingerprint/v3（首次拆解，流式）
 * 和 PATCH /api/fingerprint/v3/[id]（加样本重提炼，非流式）共享。
 *
 * 流程：prepare → stage1（并发）→ stage2（串行）→ stage3（可选）。
 * 任何一步抛 Error，调用方自行决定怎么报给前端。
 */

import { streamClaude } from '@/lib/claude';
import { crawlArticle, isCrawlError } from '@/lib/crawler';
import {
  buildFingerprintV3Stage1Prompt,
  type FingerprintV3Article,
} from '@/lib/prompts/fingerprint-v3-stage1';
import {
  buildFingerprintV3Stage2Prompt,
  type FingerprintV3Stage1Output,
} from '@/lib/prompts/fingerprint-v3-stage2';
import { buildFingerprintV3CrossPlatformPrompt } from '@/lib/prompts/fingerprint-v3-cross-platform';
import {
  buildStage0ClassifyPrompt,
  parseStage0Output,
  normalizeCategory,
  type ArticleCategory,
} from '@/lib/prompts/fingerprint-v3-stage0';
import { buildCategoryProfilePrompt } from '@/lib/prompts/fingerprint-v3-category';

export const MIN_ARTICLES = 2;
export const MAX_ARTICLES = 20;
export const MIN_CONTENT_CHARS = 80;
/**
 * 单篇样本正文上限。stage1 模板会把全文原样拼入 prompt（不做摘要），
 * 遇到超长万字文会把 prompt 撑爆、拖到超时。风格特征在前 1.5 万字里
 * 已经足够抓取，超出部分截断。
 */
export const MAX_SAMPLE_CONTENT_CHARS = 15000;
export const STAGE1_CONCURRENCY = 3;
export const STAGE0_CONCURRENCY = 4;

export interface IncomingArticleInput {
  mode?: 'url' | 'paste';
  title?: string;
  content?: string;
  url?: string;
  platform?: string;
  medium?: 'text' | 'video' | 'mixed';
  domain?: string;
  /** 可选：UI 手动指定主类，跳过 Stage 0 自动分类 */
  category?: ArticleCategory;
}

export interface PreparedArticle extends FingerprintV3Article {
  url?: string;
  source_mode: 'url' | 'paste';
  /** Stage 0 分类结果；UI 已指定时 user_specified=true */
  primary_category?: ArticleCategory | null;
  secondary_category?: ArticleCategory | null;
  category_confidence?: 'high' | 'medium' | 'low' | null;
  user_specified_category?: boolean;
}

export interface V3EngineProgress {
  onPrepare?: (i: number, total: number, p: PreparedArticle) => void;
  onPrepareFail?: (i: number, message: string) => void;
  onStage0Start?: (i: number) => void;
  onStage0Done?: (
    i: number,
    primary: ArticleCategory | null,
    secondary: ArticleCategory | null,
    confidence: 'high' | 'medium' | 'low' | null,
  ) => void;
  onStage1Start?: (i: number) => void;
  onStage1Done?: (i: number, rawJson: string) => void;
  onStage1Chunk?: (i: number, text: string) => void;
  onStage2Chunk?: (text: string) => void;
  onStage3Chunk?: (text: string) => void;
  onStageBoundary?: (
    stage: 'prepare' | 'stage0' | 'stage1' | 'stage2' | 'stage3',
    status: 'start' | 'done' | 'skipped',
  ) => void;
}

export interface V3EngineResult {
  prepared: PreparedArticle[];
  stage1Outputs: FingerprintV3Stage1Output[];
  stage2Raw: string;
  fingerprint: Record<string, unknown>;
  platformsAnalyzed: string[];
  stage3Used: boolean;
  timings: { stage1Ms: number; stage2Ms: number; stage3Ms: number };
}

export interface CategoryProfile {
  category: ArticleCategory;
  sample_count: number;
  profile_json: Record<string, unknown>;
}

const CATEGORY_MIN_SAMPLES = 3;

/**
 * 按类别合成细分指纹。只跑样本 ≥ 3 篇的类别。失败的类别静默跳过。
 * 调用方：v3 POST 路由 / PATCH 路由在主指纹合成完成后调一次，把结果写
 * fingerprint_category_profiles。
 */
export async function runCategoryProfiles(
  authorName: string,
  prepared: PreparedArticle[],
  stage1Outputs: FingerprintV3Stage1Output[],
  signal: AbortSignal,
): Promise<CategoryProfile[]> {
  // 按 primary_category 分组。stage1Outputs 可能被 filter 掉 null 而与 prepared
  // 位置错位，用输出自带的 .index 建 Map 精确对齐，不能按数组下标取。
  const outputByIndex = new Map<number, FingerprintV3Stage1Output>();
  for (const o of stage1Outputs) outputByIndex.set(o.index, o);
  const groups = new Map<ArticleCategory, FingerprintV3Stage1Output[]>();
  for (let i = 0; i < prepared.length; i++) {
    const cat = prepared[i].primary_category;
    if (!cat) continue;
    const out = outputByIndex.get(i);
    if (!out) continue;
    const arr = groups.get(cat) ?? [];
    arr.push(out);
    groups.set(cat, arr);
  }

  const results: CategoryProfile[] = [];

  for (const [category, outputs] of groups) {
    if (signal.aborted) break;
    if (outputs.length < CATEGORY_MIN_SAMPLES) continue;
    try {
      const prompt = buildCategoryProfilePrompt(authorName, category, outputs);
      // 类别合成：单类样本最多几篇，但 prompt 不小，给 360s 留 buffer
      const raw = await streamClaude(prompt, { signal, timeoutMs: 360_000 });
      const cleaned = stripJsonFence(raw);
      const profile = JSON.parse(cleaned) as Record<string, unknown>;
      results.push({
        category,
        sample_count: outputs.length,
        profile_json: profile,
      });
    } catch {
      // 单类失败不影响其他类
    }
  }

  return results;
}

export function stripJsonFence(raw: string): string {
  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    // fence 是懒匹配：字段值里再出现 ``` 会提前截断。先验证能 parse，
    // 不行就放弃 fence 结果，回退到首尾大括号截取。
    try {
      JSON.parse(inner);
      return inner;
    } catch {/* 回退大括号截取 */}
  }
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }
  return raw.trim();
}

/**
 * stage2 输出解析 + 一次自动修复重试。
 * 解析失败时把错误位置反馈给模型，让它**只输出修复后的合法 JSON**——
 * 不重新跑整个 stage2，只修语法错。POST 首拆路由和 runV3Extraction 共用。
 * 两次都失败抛 Error，调用方决定怎么报给前端。
 */
export async function parseStage2WithRepair(
  stage2Raw: string,
  signal: AbortSignal,
): Promise<{ fingerprint: Record<string, unknown>; stage2Raw: string; stage2Cleaned: string }> {
  const tryParse = (s: string): { ok: true; v: Record<string, unknown> } | { ok: false; err: Error } => {
    try {
      return { ok: true, v: JSON.parse(s) as Record<string, unknown> };
    } catch (e) {
      return { ok: false, err: e as Error };
    }
  };

  let cleaned = stripJsonFence(stage2Raw);
  const first = tryParse(cleaned);
  if (first.ok) {
    return { fingerprint: first.v, stage2Raw, stage2Cleaned: cleaned };
  }

  const errMsg = first.err.message;
  const repairPrompt = `你刚才输出的 JSON 解析失败：${errMsg}

下面是你输出的内容。请**只输出修复后的合法 JSON 代码块**（一个 \`\`\`json ... \`\`\` 围栏），前后不要任何文字、解释、寒暄。所有字段和结构不要改动，只修语法错误（漏逗号、多逗号、漏方括号 / 大括号、引号嵌套问题等）。

\`\`\`
${cleaned}
\`\`\`

现在请输出修复后的合法 JSON。`;
  // 修复重试沿用 stage2 原始 480s：最需要 repair 的恰恰是 20 篇的大指纹，
  // 模型要整段抄写一遍，360s 反而最容易在这里超时
  const repaired = await streamClaude(repairPrompt, {
    signal,
    timeoutMs: 480_000,
  });
  cleaned = stripJsonFence(repaired);
  const second = tryParse(cleaned);
  if (!second.ok) {
    throw new Error(
      `stage2 输出格式两次都没修好。首次错误：${errMsg}；重试错误：${second.err.message}`,
    );
  }
  return { fingerprint: second.v, stage2Raw: repaired, stage2Cleaned: cleaned };
}

export async function prepareSampleArticle(
  input: IncomingArticleInput,
  idx: number,
): Promise<PreparedArticle> {
  const platform = (input.platform ?? '').trim();
  if (!platform) {
    throw new Error(`第 ${idx + 1} 篇没指定 platform（公众号 / B 站 / 知乎 / ...）`);
  }
  const medium = (input.medium ?? 'text') as 'text' | 'video' | 'mixed';
  if (!['text', 'video', 'mixed'].includes(medium)) {
    throw new Error(`第 ${idx + 1} 篇 medium 取值只能是 text / video / mixed`);
  }
  const domain = (input.domain ?? '').trim() || '未指定';

  const userCategory = normalizeCategory(input.category);

  if (input.mode === 'url') {
    const url = (input.url ?? '').trim();
    if (!url) {
      throw new Error(`第 ${idx + 1} 篇的 URL 是空的，要么填上要么切到正文模式`);
    }
    const crawled = await crawlArticle(url);
    if (isCrawlError(crawled)) {
      throw new Error(
        `第 ${idx + 1} 篇 URL 抓不下来（${crawled.reason}）：${crawled.message}。建议切到正文模式贴一下。`,
      );
    }
    let content = crawled.content.trim();
    if (content.length < MIN_CONTENT_CHARS) {
      throw new Error(
        `第 ${idx + 1} 篇抓到的正文太短（${content.length} 字），可能没抓全。切到正文模式手贴吧。`,
      );
    }
    // 见 MAX_SAMPLE_CONTENT_CHARS 注释：超长正文截断，避免 stage1 prompt 爆体积
    content = content.slice(0, MAX_SAMPLE_CONTENT_CHARS);
    return {
      title: crawled.title || input.title?.trim() || undefined,
      content,
      url: crawled.url,
      platform,
      medium,
      domain,
      source_mode: 'url',
      primary_category: userCategory,
      secondary_category: null,
      category_confidence: userCategory ? 'high' : null,
      user_specified_category: !!userCategory,
    };
  }

  let content = (input.content ?? '').trim();
  if (content.length < MIN_CONTENT_CHARS) {
    throw new Error(`第 ${idx + 1} 篇正文不足 ${MIN_CONTENT_CHARS} 字，再多贴一点`);
  }
  // 见 MAX_SAMPLE_CONTENT_CHARS 注释：超长正文截断，避免 stage1 prompt 爆体积
  content = content.slice(0, MAX_SAMPLE_CONTENT_CHARS);
  return {
    title: (input.title ?? '').trim() || undefined,
    content,
    url: (input.url ?? '').trim() || undefined,
    platform,
    medium,
    domain,
    source_mode: 'paste',
    primary_category: userCategory,
    secondary_category: null,
    category_confidence: userCategory ? 'high' : null,
    user_specified_category: !!userCategory,
  };
}

/**
 * 对外暴露：仅跑 Stage 0 分类（PATCH 路由用，跑完才写库）。
 */
export async function runStage0OnPrepared(
  prepared: PreparedArticle[],
  signal: AbortSignal,
): Promise<void> {
  return runStage0(prepared, signal);
}

/**
 * Stage 0：并发跑分类。已被 user_specified 的不再跑。
 * 失败不抛错——把这条留给 UI 标"未分类"，仍能进 Stage 1 / Stage 2。
 */
async function runStage0(
  prepared: PreparedArticle[],
  signal: AbortSignal,
  progress?: V3EngineProgress,
): Promise<void> {
  const queue: number[] = [];
  for (let i = 0; i < prepared.length; i++) {
    if (!prepared[i].user_specified_category) queue.push(i);
  }
  if (queue.length === 0) return;
  let cursor = 0;

  async function worker() {
    while (true) {
      if (signal.aborted) return;
      const q = cursor++;
      if (q >= queue.length) return;
      const idx = queue[q];
      progress?.onStage0Start?.(idx);
      try {
        const prompt = buildStage0ClassifyPrompt({
          title: prepared[idx].title,
          content: prepared[idx].content,
          platform: prepared[idx].platform,
        });
        const raw = await streamClaude(prompt, { signal });
        const cleaned = stripJsonFence(raw);
        const parsed = parseStage0Output(cleaned);
        if (parsed) {
          prepared[idx].primary_category = parsed.primary;
          prepared[idx].secondary_category = parsed.secondary;
          prepared[idx].category_confidence = parsed.confidence;
          progress?.onStage0Done?.(idx, parsed.primary, parsed.secondary, parsed.confidence);
        } else {
          prepared[idx].primary_category = null;
          prepared[idx].secondary_category = null;
          prepared[idx].category_confidence = null;
          progress?.onStage0Done?.(idx, null, null, null);
        }
      } catch {
        prepared[idx].primary_category = null;
        prepared[idx].secondary_category = null;
        prepared[idx].category_confidence = null;
        progress?.onStage0Done?.(idx, null, null, null);
      }
    }
  }

  const n = Math.min(STAGE0_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

async function runStage1(
  prepared: PreparedArticle[],
  signal: AbortSignal,
  progress?: V3EngineProgress,
): Promise<FingerprintV3Stage1Output[]> {
  const outputs: (FingerprintV3Stage1Output | null)[] = prepared.map(() => null);
  let cursor = 0;

  async function worker() {
    while (true) {
      if (signal.aborted) return;
      const idx = cursor++;
      if (idx >= prepared.length) return;
      progress?.onStage1Start?.(idx);
      const prompt = buildFingerprintV3Stage1Prompt(prepared[idx], idx, prepared.length);
      // stage1 单篇拼全文，默认 180s 对长文不够，显式给 300s
      const raw = await streamClaude(prompt, {
        signal,
        onChunk: progress?.onStage1Chunk ? (text) => progress.onStage1Chunk!(idx, text) : undefined,
        timeoutMs: 300_000,
      });
      const cleaned = stripJsonFence(raw);
      outputs[idx] = {
        index: idx,
        platform: prepared[idx].platform,
        domain: prepared[idx].domain || '未指定',
        medium: prepared[idx].medium,
        title: prepared[idx].title,
        rawJson: cleaned,
      };
      progress?.onStage1Done?.(idx, cleaned);
    }
  }

  const n = Math.min(STAGE1_CONCURRENCY, prepared.length);
  const workers = Array.from({ length: n }, () => worker());
  await Promise.all(workers);

  return outputs.filter((o): o is FingerprintV3Stage1Output => o !== null);
}

/**
 * 跑完整 v3 提炼流程（prepare 之后）。
 * 调用前 prepared 必须已通过 prepareSampleArticle 校验。
 */
export async function runV3Extraction(
  prepared: PreparedArticle[],
  authorName: string,
  signal: AbortSignal,
  progress?: V3EngineProgress,
): Promise<V3EngineResult> {
  if (prepared.length < MIN_ARTICLES) {
    throw new Error(`样本不够（${prepared.length}/${MIN_ARTICLES}）`);
  }

  // Stage 0：自动分类（user_specified 的会跳过）
  progress?.onStageBoundary?.('stage0', 'start');
  await runStage0(prepared, signal, progress);
  progress?.onStageBoundary?.('stage0', 'done');

  // Stage 1
  progress?.onStageBoundary?.('stage1', 'start');
  const t1 = Date.now();
  const stage1Outputs = await runStage1(prepared, signal, progress);
  const stage1Ms = Date.now() - t1;
  progress?.onStageBoundary?.('stage1', 'done');

  // Stage 2
  progress?.onStageBoundary?.('stage2', 'start');
  const t2 = Date.now();
  const stage2Prompt = buildFingerprintV3Stage2Prompt(authorName, stage1Outputs);
  // Stage 2 是跨篇合成，prompt 体积随样本数线性涨；20 篇 ≈ 60-80k 字。给 480s
  const stage2FirstRaw = await streamClaude(stage2Prompt, {
    signal,
    onChunk: progress?.onStage2Chunk,
    timeoutMs: 480_000,
  });
  // 解析 + 一次自动修复重试（逻辑抽在 parseStage2WithRepair，POST 路由共用）
  const stage2Parsed = await parseStage2WithRepair(stage2FirstRaw, signal);
  const stage2Raw = stage2Parsed.stage2Raw;
  const stage2Cleaned = stage2Parsed.stage2Cleaned;
  const fingerprint = stage2Parsed.fingerprint;
  const stage2Ms = Date.now() - t2;
  progress?.onStageBoundary?.('stage2', 'done');

  const platformsAnalyzed = Array.from(new Set(prepared.map((p) => p.platform)));

  // Stage 3（多平台样本才跑）。触发条件以 prepared 的真实平台集合为准，
  // 与 POST 路由一致——模型输出的 platforms_analyzed 可能漏报 / 幻报。
  let stage3Ms = 0;
  let stage3Used = false;

  if (platformsAnalyzed.length >= 2) {
    progress?.onStageBoundary?.('stage3', 'start');
    const t3 = Date.now();
    try {
      const stage3Prompt = buildFingerprintV3CrossPlatformPrompt({
        authorName,
        stage2RawJson: stage2Cleaned,
      });
      const stage3Raw = await streamClaude(stage3Prompt, {
        signal,
        onChunk: progress?.onStage3Chunk,
        timeoutMs: 360_000,
      });
      const stage3Cleaned = stripJsonFence(stage3Raw);
      try {
        const stage3Obj = JSON.parse(stage3Cleaned) as Record<string, unknown>;
        fingerprint.cross_platform_report = stage3Obj;
        stage3Used = true;
      } catch {/* 沿用 stage2 初稿 */}
    } catch {/* 沿用 stage2 初稿 */}
    stage3Ms = Date.now() - t3;
    progress?.onStageBoundary?.('stage3', 'done');
  } else {
    progress?.onStageBoundary?.('stage3', 'skipped');
  }

  return {
    prepared,
    stage1Outputs,
    stage2Raw,
    fingerprint,
    platformsAnalyzed,
    stage3Used,
    timings: { stage1Ms, stage2Ms, stage3Ms },
  };
}
