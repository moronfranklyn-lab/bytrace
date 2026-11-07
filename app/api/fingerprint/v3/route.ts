import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { streamClaude } from '@/lib/claude';
import { createHash } from 'node:crypto';
import { crawlArticle, hashUrl, isCrawlError } from '@/lib/crawler';
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
import { parseStage2WithRepair } from '@/lib/fingerprints/v3-engine';
import { pickAvatarChar } from '@/lib/authors/avatar';
import { getDb } from '@/lib/db';

/**
 * Agent J · v3 指纹拆解
 * ----------------------------------------------------------------
 * 三阶段 SSE：
 *   Stage 1（并发，最多 3）：每篇独立分析，提取局部策略碎片 + 平台/领域调整
 *   Stage 2（串行）        ：跨篇综合，按平台分组 + 按领域分组 + 策略碎片库
 *   Stage 3（串行，可选）  ：当 platforms_analyzed.length >= 2 时，跨平台深度对比
 *
 * 与 v2 兼容：v2 路由保留，本路由独立挂在 /api/fingerprint/v3。
 * fingerprints 表新写入 version_schema='v3' 与 4 个 v3 专属 JSON 列。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingArticleInput {
  /** 'url' = 后端用 crawler 抓正文；'paste' = 直接用 content 字段。不传按 paste 兼容老调用 */
  mode?: 'url' | 'paste';
  title?: string;
  content?: string;
  url?: string;
  platform?: string;
  medium?: 'text' | 'video' | 'mixed';
  domain?: string;
  /** 可选：UI 上"类别"标签；prompt 暂未使用，仅入库 */
  category?: string;
}

interface IncomingPayload {
  author_name?: string;
  articles?: IncomingArticleInput[];
}

const MIN_ARTICLES = 2;
const MAX_ARTICLES = 20;
const MIN_CONTENT_CHARS = 80;
const STAGE1_CONCURRENCY = 3;
// 单篇样本正文上限：stage1 模板把全文原样拼入 prompt，超长万字文会撑爆
// prompt 体积、拖到超时。风格特征在前 1.5 万字里已经足够抓取，超出截断。
const MAX_SAMPLE_CONTENT_CHARS = 15000;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function stripJsonFence(raw: string): string {
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

// 样本去重哈希：URL 模式哈希 URL；paste 模式哈希正文前 200 字。
// prepare 批内去重和落库 fingerprint_articles 共用同一口径。
function sampleHash(p: { url?: string; content: string }): string {
  if (p.url) return hashUrl(p.url);
  return 'paste:' + createHash('sha1').update(p.content.slice(0, 200)).digest('hex').slice(0, 16);
}

interface PreparedArticle extends FingerprintV3Article {
  url?: string;
  primary_category?: ArticleCategory | null;
  secondary_category?: ArticleCategory | null;
  category_confidence?: 'high' | 'medium' | 'low' | null;
  user_specified_category?: boolean;
}

const STAGE0_CONCURRENCY = 4;

async function prepareArticle(input: IncomingArticleInput, idx: number): Promise<PreparedArticle> {
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

  // mode=url：用 crawler 抓正文；其它情况按 paste 兼容
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
      primary_category: userCategory,
      secondary_category: null,
      category_confidence: userCategory ? 'high' : null,
      user_specified_category: !!userCategory,
    };
  }

  // paste 模式
  let content = (input.content ?? '').trim();
  if (content.length < MIN_CONTENT_CHARS) {
    throw new Error(
      `第 ${idx + 1} 篇正文不足 ${MIN_CONTENT_CHARS} 字，再多贴一点`,
    );
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
    primary_category: userCategory,
    secondary_category: null,
    category_confidence: userCategory ? 'high' : null,
    user_specified_category: !!userCategory,
  };
}

/**
 * Stage 0：并发自动分类（user_specified 的跳过）。
 * 失败不抛错，让该条留 null，UI 上显示"未分类"。
 */
async function runStage0Classification(
  prepared: PreparedArticle[],
  signal: AbortSignal,
  onDone: (i: number, primary: ArticleCategory | null) => void,
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
          onDone(idx, parsed.primary);
        } else {
          onDone(idx, null);
        }
      } catch {
        onDone(idx, null);
      }
    }
  }

  const n = Math.min(STAGE0_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

async function runStage1WithConcurrency(
  prepared: PreparedArticle[],
  signal: AbortSignal,
  onItemStart: (i: number) => void,
  onItemDone: (i: number, rawJson: string) => void,
  onChunk: (i: number, text: string) => void,
): Promise<FingerprintV3Stage1Output[]> {
  const outputs: (FingerprintV3Stage1Output | null)[] = prepared.map(() => null);
  let cursor = 0;

  async function worker() {
    while (true) {
      if (signal.aborted) return;
      const idx = cursor++;
      if (idx >= prepared.length) return;
      onItemStart(idx);
      const prompt = buildFingerprintV3Stage1Prompt(prepared[idx], idx, prepared.length);
      // stage1 单篇拼全文，默认 180s 对长文不够，显式给 300s
      const raw = await streamClaude(prompt, {
        signal,
        onChunk: (text) => onChunk(idx, text),
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
      onItemDone(idx, cleaned);
    }
  }

  const n = Math.min(STAGE1_CONCURRENCY, prepared.length);
  const workers = Array.from({ length: n }, () => worker());
  await Promise.all(workers);

  return outputs.filter((o): o is FingerprintV3Stage1Output => o !== null);
}

export async function POST(req: NextRequest) {
  let body: IncomingPayload;
  try {
    body = (await req.json()) as IncomingPayload;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }

  const authorName = (body.author_name ?? '').trim();
  const articles = Array.isArray(body.articles) ? body.articles : [];

  if (!authorName) {
    return jsonError('博主名不能为空');
  }
  if (articles.length < MIN_ARTICLES || articles.length > MAX_ARTICLES) {
    return jsonError(
      `文章数量需要在 ${MIN_ARTICLES} 到 ${MAX_ARTICLES} 篇之间，当前 ${articles.length} 篇`,
    );
  }

  const encoder = new TextEncoder();
  const abortCtrl = new AbortController();
  req.signal.addEventListener('abort', () => abortCtrl.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {/* controller closed */}
      };
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {/* ignore */}
      };

      try {
        send('open', { ok: true, total: articles.length });

        // ---- Step 1: 准备 ----
        send('stage', { stage: 'prepare', message: '正在准备样本' });
        const prepared: PreparedArticle[] = [];
        // 批内去重：同一批里重复贴同一 URL / 同一段正文，只算一篇，
        // 否则样本权重翻倍、article_count 也会虚记
        const seenHashes = new Set<string>();
        for (let i = 0; i < articles.length; i++) {
          if (abortCtrl.signal.aborted) {
            send('error', { message: '已中止', phase: 'abort' });
            closeStream();
            return;
          }
          try {
            const p = await prepareArticle(articles[i], i);
            const h = sampleHash(p);
            if (seenHashes.has(h)) {
              send('article', {
                index: i,
                status: 'skipped-duplicate',
                title: p.title || '（无标题）',
                message: '这篇和本批前面的样本重复了，只算一篇',
              });
              continue;
            }
            seenHashes.add(h);
            prepared.push(p);
            send('article', {
              index: i,
              status: 'ready',
              title: p.title || '（无标题）',
              platform: p.platform,
              medium: p.medium,
              domain: p.domain,
              chars: p.content.length,
            });
          } catch (err) {
            send('error', {
              message: (err as Error).message || '准备样本时出错',
              phase: 'prepare',
              index: i,
            });
            closeStream();
            return;
          }
        }

        // 去重可能把样本削到下限以下，提前拦住
        if (prepared.length < MIN_ARTICLES) {
          send('error', {
            message: `去重后只剩 ${prepared.length} 篇有效样本，至少要 ${MIN_ARTICLES} 篇。换一篇不同的文章再来吧。`,
            phase: 'prepare',
          });
          closeStream();
          return;
        }

        const platformsAnalyzed = Array.from(
          new Set(prepared.map((p) => p.platform).filter(Boolean)),
        );

        // ---- Step 1.5: Stage 0 自动分类（user_specified 跳过）----
        send('stage', { stage: 'stage0', message: '正在给文章打类别标签' });
        const t0 = Date.now();
        try {
          await runStage0Classification(prepared, abortCtrl.signal, (i, primary) => {
            send('article', {
              index: i,
              status: 'categorized',
              primary_category: primary,
              secondary_category: prepared[i].secondary_category ?? null,
              category_confidence: prepared[i].category_confidence ?? null,
            });
          });
        } catch (err) {
          // Stage 0 失败不阻塞主流程，但发个 warn
          send('warn', {
            phase: 'stage0',
            message: '自动分类阶段异常：' + ((err as Error).message || '未知错误') + '，继续往下走',
          });
        }
        send('stage', { stage: 'stage0', status: 'done', ms: Date.now() - t0 });

        // ---- Step 2: Stage1 ----
        send('stage', {
          stage: 'stage1',
          message: '正在逐篇拆出局部策略碎片',
          concurrency: STAGE1_CONCURRENCY,
        });
        const t1 = Date.now();
        let stage1Outputs: FingerprintV3Stage1Output[] = [];
        try {
          stage1Outputs = await runStage1WithConcurrency(
            prepared,
            abortCtrl.signal,
            (i) => send('article', { index: i, status: 'analyzing' }),
            (i, rawJson) => {
              let okJson = true;
              try { JSON.parse(rawJson); } catch { okJson = false; }
              send('article', {
                index: i,
                status: okJson ? 'analyzed' : 'analyzed-loose',
              });
            },
            (i, text) => send('chunk', { stage: 'stage1', index: i, text }),
          );
        } catch (err) {
          send('error', {
            message:
              '某一篇拆解时模型没回来：' +
              ((err as Error).message || '未知错误'),
            phase: 'stage1',
          });
          closeStream();
          return;
        }
        const stage1Ms = Date.now() - t1;
        send('stage', { stage: 'stage1', status: 'done', ms: stage1Ms });

        // ---- Step 3: Stage2 ----
        send('stage', { stage: 'stage2', message: '正在跨篇综合按平台 / 领域分组' });
        const t2 = Date.now();
        let stage2Raw = '';
        try {
          const stage2Prompt = buildFingerprintV3Stage2Prompt(
            authorName,
            stage1Outputs,
          );
          stage2Raw = await streamClaude(stage2Prompt, {
            signal: abortCtrl.signal,
            onChunk: (text) => send('chunk', { stage: 'stage2', text }),
            timeoutMs: 480_000,
          });
        } catch (err) {
          send('error', {
            message:
              '综合阶段模型没回来：' + ((err as Error).message || '未知错误'),
            phase: 'stage2',
          });
          closeStream();
          return;
        }
        const stage2Ms = Date.now() - t2;

        // 解析 + 一次自动修复重试（复用 engine 的 parseStage2WithRepair）：
        // 20 篇跑了 8 分钟，不能因为模型漏个逗号整次作废
        let stage2Cleaned: string;
        let fingerprint: Record<string, unknown>;
        try {
          const stage2Parsed = await parseStage2WithRepair(stage2Raw, abortCtrl.signal);
          fingerprint = stage2Parsed.fingerprint;
          stage2Raw = stage2Parsed.stage2Raw;
          stage2Cleaned = stage2Parsed.stage2Cleaned;
        } catch (parseErr) {
          send('error', {
            message: 'stage2 输出的 JSON 这次没修好，再试一次大概率就好',
            phase: 'parse-stage2',
            detail: (parseErr as Error).message,
            sample: stripJsonFence(stage2Raw).slice(0, 280),
          });
          closeStream();
          return;
        }
        send('stage', { stage: 'stage2', status: 'done', ms: stage2Ms });

        // ---- Step 4: Stage3（可选） ----
        let stage3Ms = 0;
        if (platformsAnalyzed.length >= 2) {
          send('stage', {
            stage: 'stage3',
            message: '正在跑跨平台深度对比报告',
          });
          const t3 = Date.now();
          try {
            const stage3Prompt = buildFingerprintV3CrossPlatformPrompt({
              authorName,
              stage2RawJson: stage2Cleaned,
            });
            const stage3Raw = await streamClaude(stage3Prompt, {
              signal: abortCtrl.signal,
              onChunk: (text) => send('chunk', { stage: 'stage3', text }),
              timeoutMs: 360_000,
            });
            const stage3Cleaned = stripJsonFence(stage3Raw);
            try {
              const stage3Obj = JSON.parse(stage3Cleaned) as Record<string, unknown>;
              // 用 stage3 替换 stage2 给的初稿 cross_platform_report
              fingerprint.cross_platform_report = stage3Obj;
            } catch (parseErr) {
              // 不致命：保留 stage2 初稿，给 client 一个 warn
              send('warn', {
                phase: 'parse-stage3',
                message: 'stage3 输出不是合法 JSON，沿用 stage2 初稿',
                detail: (parseErr as Error).message,
              });
            }
          } catch (err) {
            send('warn', {
              phase: 'stage3',
              message:
                '跨平台对比阶段模型没回来：' +
                ((err as Error).message || '未知错误') +
                '。沿用 stage2 初稿。',
            });
          }
          stage3Ms = Date.now() - t3;
          send('stage', { stage: 'stage3', status: 'done', ms: stage3Ms });
        } else {
          send('stage', {
            stage: 'stage3',
            status: 'skipped',
            reason: '只有单平台样本，跳过跨平台对比',
          });
        }

        // ---- Step 4.5: 按类别细分指纹（每类 ≥ 3 篇才跑）----
        // 按 primary_category 把 stage1Outputs 分组，每组单独再请 Claude 合成一份小指纹。
        // 单类失败不影响其他类，全失败也不阻塞主流程。
        send('stage', { stage: 'category-profiles', message: '正在按类别细分指纹' });
        const t4 = Date.now();
        // stage1Outputs 可能被 filter 掉 null 而与 prepared 位置错位，
        // 用输出自带的 .index 建 Map 精确对齐，不能按数组下标取
        const outputByIndex = new Map<number, FingerprintV3Stage1Output>();
        for (const o of stage1Outputs) outputByIndex.set(o.index, o);
        const categoryGroups = new Map<ArticleCategory, typeof stage1Outputs>();
        for (let i = 0; i < prepared.length; i++) {
          const cat = prepared[i].primary_category;
          if (!cat) continue;
          const out = outputByIndex.get(i);
          if (!out) continue;
          const arr = categoryGroups.get(cat) ?? [];
          arr.push(out);
          categoryGroups.set(cat, arr);
        }
        const categoryProfiles: Array<{
          category: ArticleCategory;
          sample_count: number;
          profile_json: Record<string, unknown>;
        }> = [];
        for (const [category, outputs] of categoryGroups) {
          if (abortCtrl.signal.aborted) break;
          if (outputs.length < 3) continue;
          try {
            const prompt = buildCategoryProfilePrompt(authorName, category, outputs);
            const raw = await streamClaude(prompt, {
              signal: abortCtrl.signal,
              onChunk: (text) =>
                send('chunk', { stage: 'category-profile', category, text }),
              timeoutMs: 360_000,
            });
            const cleaned = stripJsonFence(raw);
            const profile = JSON.parse(cleaned) as Record<string, unknown>;
            categoryProfiles.push({
              category,
              sample_count: outputs.length,
              profile_json: profile,
            });
            send('category-profile-done', { category, sample_count: outputs.length });
          } catch (err) {
            send('warn', {
              phase: 'category-profile',
              category,
              message: '类别细分失败：' + ((err as Error).message || '未知错误'),
            });
          }
        }
        send('stage', { stage: 'category-profiles', status: 'done', ms: Date.now() - t4 });

        // ---- Step 5: 落库 ----
        try {
          const db = getDb();
          const authorId = nanoid(12);
          const fingerprintId = nanoid(14);
          const now = Date.now();

          const platformsFromFp = Array.isArray(
            (fingerprint as { platforms_analyzed?: unknown[] }).platforms_analyzed,
          )
            ? (fingerprint as { platforms_analyzed: unknown[] }).platforms_analyzed
            : platformsAnalyzed;
          // 用 stage2 字段，平台多但作者级 platform 字段挑第一个填进 authors 表（向后兼容）
          const primaryPlatform =
            (Array.isArray(platformsFromFp) && typeof platformsFromFp[0] === 'string'
              ? (platformsFromFp[0] as string)
              : null) ?? platformsAnalyzed[0] ?? null;

          const insertAuthor = db.prepare(
            `INSERT INTO authors (id, name, platform, avatar_emoji, created_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          );
          const insertFingerprint = db.prepare(
            `INSERT INTO fingerprints
              (id, author_id, source_articles_json, fingerprint_json, raw_response,
               model_version, created_at, hit_count, version, article_count,
               version_schema, platform_fingerprints_json, domain_variations_json,
               cross_platform_report_json, strategy_fragments_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 3, ?, 'v3', ?, ?, ?, ?)`,
          );
          const insertStrategy = db.prepare(
            `INSERT INTO strategies
              (id, fingerprint_id, tag, scope_json, description, example, when_to_use,
               created_at, platform_scope_json, domain_scope_json, why_works, title)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          // 加样本能力：每篇 prepared article 持久化到 fingerprint_articles
          // 用于去重 + 累计重提炼。url_hash：URL 模式哈希 URL；paste 模式哈希正文前 200 字。
          const insertFingerprintArticle = db.prepare(
            `INSERT OR IGNORE INTO fingerprint_articles
              (fingerprint_id, url_hash, url, title, content, platform, medium,
               domain, source_mode, added_at, iteration,
               primary_category, secondary_category, category_confidence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          );
          const insertCategoryProfile = db.prepare(
            `INSERT OR REPLACE INTO fingerprint_category_profiles
              (fingerprint_id, category, profile_json, sample_count, iteration, updated_at)
             VALUES (?, ?, ?, ?, 1, ?)`,
          );
          const insertFragmentIndexed = db.prepare(
            `INSERT INTO strategy_fragments_indexed
              (id, fingerprint_id, author_name, category, tag, title, description,
               example, when_to_use, why_works, platform_scope_json, domain_scope_json,
               created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const sourceArticlesSummary = prepared.map((p) => ({
            title: p.title,
            platform: p.platform,
            domain: p.domain,
            medium: p.medium,
            url: p.url,
            chars: p.content.length,
          }));

          const strategyFragments = Array.isArray(
            (fingerprint as { strategy_fragments?: unknown[] }).strategy_fragments,
          )
            ? ((fingerprint as { strategy_fragments: unknown[] }).strategy_fragments as Record<string, unknown>[])
            : [];

          const platformFingerprints =
            (fingerprint as { platform_fingerprints?: unknown }).platform_fingerprints ?? null;
          const domainVariations =
            (fingerprint as { domain_variations?: unknown }).domain_variations ?? null;
          const crossPlatformReport =
            (fingerprint as { cross_platform_report?: unknown }).cross_platform_report ?? null;

          const tx = db.transaction(() => {
            insertAuthor.run(
              authorId,
              authorName,
              primaryPlatform,
              pickAvatarChar(authorName),
              now,
              now,
            );
            insertFingerprint.run(
              fingerprintId,
              authorId,
              JSON.stringify(sourceArticlesSummary),
              JSON.stringify(fingerprint),
              stage2Raw,
              'claude-code-cli-v3',
              now,
              prepared.length,
              platformFingerprints ? JSON.stringify(platformFingerprints) : null,
              domainVariations ? JSON.stringify(domainVariations) : null,
              crossPlatformReport ? JSON.stringify(crossPlatformReport) : null,
              strategyFragments.length ? JSON.stringify(strategyFragments) : null,
            );
            // 写 strategies（v3 每条带 platform_scope / domain_scope / why_works / title）
            for (const s of strategyFragments) {
              insertStrategy.run(
                nanoid(14),
                fingerprintId,
                (s.tag as string) || null,
                JSON.stringify(s.domain_scope ?? s.platform_scope ?? []), // 兼容 v2 的 scope_json
                (s.description as string) || null,
                (s.example as string) || null,
                (s.when_to_use as string) || null,
                now,
                JSON.stringify(s.platform_scope ?? []),
                JSON.stringify(s.domain_scope ?? []),
                (s.why_works as string) || null,
                (s.title as string) || null,
              );
            }
            // 写 fingerprint_articles：每篇样本一行（首轮 iteration=1，附 Stage 0 分类）
            for (const p of prepared) {
              insertFingerprintArticle.run(
                fingerprintId,
                sampleHash(p),
                p.url ?? null,
                p.title ?? null,
                p.content,
                p.platform,
                p.medium,
                p.domain,
                p.url ? 'url' : 'paste',
                now,
                p.primary_category ?? null,
                p.secondary_category ?? null,
                p.category_confidence ?? null,
              );
            }
            // 写按类别细分指纹
            for (const cp of categoryProfiles) {
              insertCategoryProfile.run(
                fingerprintId,
                cp.category,
                JSON.stringify(cp.profile_json),
                cp.sample_count,
                now,
              );
              // 该类别下的 category_specific_fragments 也写到跨博主索引表
              const fragments = Array.isArray(
                (cp.profile_json as { category_specific_fragments?: unknown[] })
                  .category_specific_fragments,
              )
                ? ((cp.profile_json as { category_specific_fragments: unknown[] })
                    .category_specific_fragments as Record<string, unknown>[])
                : [];
              for (const f of fragments) {
                insertFragmentIndexed.run(
                  nanoid(14),
                  fingerprintId,
                  authorName,
                  cp.category,
                  (f.tag as string) || null,
                  (f.title as string) || null,
                  (f.description as string) || null,
                  (f.example as string) || null,
                  (f.when_to_use as string) || null,
                  (f.why_works as string) || null,
                  JSON.stringify(f.platform_scope ?? []),
                  JSON.stringify(f.domain_scope ?? []),
                  now,
                );
              }
            }
            // 同时把主指纹的全局 strategy_fragments 也写入索引表（category 用主类别 fallback）
            for (const s of strategyFragments) {
              insertFragmentIndexed.run(
                nanoid(14),
                fingerprintId,
                authorName,
                null, // 全局碎片不绑类别
                (s.tag as string) || null,
                (s.title as string) || null,
                (s.description as string) || null,
                (s.example as string) || null,
                (s.when_to_use as string) || null,
                (s.why_works as string) || null,
                JSON.stringify(s.platform_scope ?? []),
                JSON.stringify(s.domain_scope ?? []),
                now,
              );
            }
          });
          tx();

          send('done', {
            fingerprint_id: fingerprintId,
            author_id: authorId,
            schema: 'v3',
            article_count: prepared.length,
            platforms_analyzed: platformsAnalyzed,
            categories_analyzed: categoryProfiles.map((c) => ({
              category: c.category,
              sample_count: c.sample_count,
            })),
            strategy_count: strategyFragments.length,
            timings_ms: {
              stage1: stage1Ms,
              stage2: stage2Ms,
              stage3: stage3Ms,
              total: stage1Ms + stage2Ms + stage3Ms,
            },
          });
        } catch (dbErr) {
          send('error', {
            message: '本地数据库这次没接住，看一眼 console 再来一遍',
            phase: 'db',
            detail: (dbErr as Error).message,
          });
        }
      } finally {
        closeStream();
      }
    },
    cancel() {
      abortCtrl.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
