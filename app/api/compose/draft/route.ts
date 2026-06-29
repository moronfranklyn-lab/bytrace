import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { streamClaude, ARTICLE_MODEL } from '@/lib/claude';
import { buildArticlePrompt } from '@/lib/prompts/article';
import { buildRewriteHintBlock } from '@/lib/prompts/critic';
import {
  buildFingerprintMetaMap,
  type Composition,
  type FingerprintMeta,
} from '@/lib/composition';
import { normalizeOutline, type Outline } from '@/lib/prompts/outline';
import { getDb } from '@/lib/db';
import { ensureComposeColumns } from '@/lib/compose-schema';
import { createSseStream, stripMarkdownFence } from '@/lib/sse';
import { isValidPlatformKey, type PlatformKey } from '@/lib/platforms';
import {
  CRITIC_MAX_ATTEMPTS,
  CRITIC_PASS_THRESHOLD,
  pickBestRun,
  runSingleCritic,
  type CriticRunRecord,
} from '@/lib/critic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingPayload {
  idea?: string;
  composition?: Composition;
  outline?: unknown;
  /** 用户提前指定的主标题（可选；如果空，从生成的 markdown 里解析） */
  title?: string;
  /** 目标平台（v3 新增）。空则走通用 wechat。也是 platforms[0] 的默认值。 */
  target_platform?: string;
  /**
   * 多平台扩写：一次循环跑多份 draft，按平台顺序串行。
   * - 第一个平台 = 主平台（决定 articles.platform_target、决定主 site_id 注入）
   * - 单平台路径下（数组长度 1，或者干脆没传 platforms）行为与原 draft 完全一致
   */
  platforms?: string[];
  /** v3.3：目标站点画像 id；传了就把站点画像注入主平台 article prompt（非主平台不挑站点画像，按决策 1） */
  target_site_id?: string;
  /**
   * v3.4 · Reflection Loop 开关。
   * - true（默认）：草稿落地后跑 critic，不达标则带 hint 重写，最多 2 次
   * - false：完全跳过 critic，等同 v3.3 行为。给"有/无 critic 对比评测"用
   */
  use_critic?: boolean;
  /**
   * v3.5：codex 联网搜集的素材包（事实/数据/反方/来源）。
   * 由前端从 /api/compose/gather 拿到后透传过来；空 = 不注入。
   */
  research_material?: string;
}

interface SiteProfileRow {
  id: string;
  site_name: string;
  section: string | null;
  profile_json: string;
}

const MIN_IDEA_CHARS = 30;
/** 每个平台单独跑一次 streamClaude 的硬超时（4 分钟） */
const PER_PLATFORM_TIMEOUT_MS = 240_000;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function extractTitleFromMarkdown(md: string): string | null {
  const m = md.match(/^[#]\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function countWords(s: string): number {
  return s.replace(/\s+/g, '').length;
}

/** 极简 markdown -> html（够公众号预览用） */
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inQuote = false;

  const closeList = () => {
    if (listType) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>');
      listType = null;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };

  const renderInline = (s: string): string => {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      closeQuote();
      continue;
    }

    if (/^#\s+/.test(line)) {
      closeList(); closeQuote();
      out.push(`<h1 class="article-title">${renderInline(line.replace(/^#\s+/, ''))}</h1>`);
      continue;
    }
    if (/^##\s+/.test(line)) {
      closeList(); closeQuote();
      out.push(`<h2 class="article-h2">${renderInline(line.replace(/^##\s+/, ''))}</h2>`);
      continue;
    }
    if (/^>\s+/.test(line)) {
      closeList();
      if (!inQuote) {
        out.push('<blockquote class="article-quote">');
        inQuote = true;
      }
      out.push(`<p>${renderInline(line.replace(/^>\s+/, ''))}</p>`);
      continue;
    }
    closeQuote();
    if (/^-\s+/.test(line)) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${renderInline(line.replace(/^-\s+/, ''))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${renderInline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  closeQuote();
  return out.join('\n');
}

export async function POST(req: NextRequest) {
  let body: IncomingPayload;
  try {
    body = (await req.json()) as IncomingPayload;
  } catch {
    return jsonError('请求体不是合法 JSON');
  }
  const idea = (body.idea ?? '').trim();
  if (idea.length < MIN_IDEA_CHARS) {
    return jsonError(`题材思路至少 ${MIN_IDEA_CHARS} 字`);
  }
  const composition: Composition = body.composition ?? { selected_authors: [] };
  const outline: Outline | null = normalizeOutline(body.outline);
  if (!outline) {
    return jsonError('大纲缺失或格式不对');
  }
  // v3.4：critic 默认开启，前端可以通过 use_critic: false 显式关掉（评测模式）
  const useCritic = body.use_critic !== false;
  // v3.5：codex 搜集的素材包（事实底座）。前端从 /api/compose/gather 拿到后透传。
  // 空 = 不注入，prompt 自动降级到 v3.4 行为。
  const researchMaterial = typeof body.research_material === 'string'
    ? body.research_material
    : undefined;

  // ---- 主平台解析 ----
  let primaryPlatform: PlatformKey | null = null;
  if (typeof body.target_platform === 'string' && body.target_platform.trim()) {
    const tp = body.target_platform.trim();
    if (!isValidPlatformKey(tp)) {
      return jsonError(`目标平台 "${tp}" 不在允许列表里`);
    }
    primaryPlatform = tp;
  }

  // ---- 顺手出的平台列表（决策 1）----
  // 入参 platforms 未传 / 空 → 单平台路径，等同现状。
  // 入参 platforms 传了 → 按数组顺序循环；为了稳，把主平台强制摆在第一位（即使前端没去重）。
  let platformList: PlatformKey[] = [];
  if (Array.isArray(body.platforms) && body.platforms.length > 0) {
    const seen = new Set<PlatformKey>();
    const pushUnique = (k: string) => {
      const s = k.trim();
      if (!s) return;
      if (!isValidPlatformKey(s)) return;
      if (seen.has(s)) return;
      seen.add(s);
      platformList.push(s);
    };
    // 主平台必须排第一位
    if (primaryPlatform) pushUnique(primaryPlatform);
    for (const p of body.platforms) {
      if (typeof p === 'string') pushUnique(p);
    }
  } else {
    // 单平台路径：等同现状。即使没显式选平台也走"wechat"作为兜底，与原 articles.platform_target 落库行为一致。
    platformList = [primaryPlatform ?? 'wechat'];
  }

  if (platformList.length === 0) {
    return jsonError('没有任何目标平台');
  }
  // 主平台对外暴露的 key（落 articles.platform_target 用）
  const mainPlatformKey: PlatformKey = platformList[0];

  try {
    ensureComposeColumns();
  } catch (err) {
    return jsonError(`数据库结构升级失败：${(err as Error).message}`, 500);
  }

  // ---- 一次性把指纹 / 站点画像查出来 ----
  let fpMap = new Map<string, FingerprintMeta>();
  let siteProfile: Record<string, unknown> | null = null;
  let siteLabel: string | null = null;
  try {
    const db = getDb();
    const ids = composition.selected_authors.map((a) => a.fingerprint_id);
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT f.id, f.author_id, f.fingerprint_json,
                  a.name AS author_name, a.platform
           FROM fingerprints f
           JOIN authors a ON a.id = f.author_id
           WHERE f.id IN (${placeholders})`,
        )
        .all(...ids) as Array<{
          id: string;
          fingerprint_json: string;
          author_name: string;
          platform: string | null;
        }>;
      fpMap = buildFingerprintMetaMap(rows);
    }

    // 决策 1：站点画像只对主平台生效。非主平台走 generic。
    if (body.target_site_id) {
      const row = db
        .prepare(`SELECT id, site_name, section, profile_json FROM sites WHERE id = ?`)
        .get(body.target_site_id) as SiteProfileRow | undefined;
      if (row) {
        try { siteProfile = JSON.parse(row.profile_json); } catch {/* keep null */}
        siteLabel = row.section ? `${row.site_name} · ${row.section}` : row.site_name;
      }
    }
  } catch (err) {
    return jsonError(`数据库读取失败：${(err as Error).message}`, 500);
  }

  return createSseStream(async (send, _close, abortSignal) => {
    // 协议：连接打开第一个事件先告诉 UI 起 N 个 tab（决策 5）
    send('open', {
      ok: true,
      sections: outline.sections.length,
      platforms: platformList,
      main_platform: mainPlatformKey,
    });

    // 收集每平台产出
    const perPlatformContent = new Map<PlatformKey, string>();
    const errors: Array<{ platform: PlatformKey; message: string }> = [];
    // v3.4：每平台的 critic 历次评分（落库 + best-of-N 兜底用）
    const perPlatformCriticRuns = new Map<PlatformKey, CriticRunRecord[]>();

    for (let i = 0; i < platformList.length; i += 1) {
      if (abortSignal.aborted) break;
      const platform = platformList[i];
      const isMain = i === 0;
      // 决策 1：非主平台不挑站点画像，走 generic
      const siteCtxForThis = isMain
        ? { siteLabel, siteProfile }
        : { siteLabel: null, siteProfile: null };

      send('platform_start', {
        platform,
        index: i,
        is_main: isMain,
      });

      // ===== v3.4 Reflection Loop =====
      // 流程：写草稿 → critic 评分 → 不达标 + 还有次数 → 带 hint 重写 → 直到 pass 或用完。
      // useCritic=false 时退化为"只跑 1 轮，不评分"——评测对照组。
      const maxAttempts = useCritic ? CRITIC_MAX_ATTEMPTS : 1;
      const runsForThisPlatform: CriticRunRecord[] = [];
      let lastDraftMd = '';
      let platformErrored = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (abortSignal.aborted) break;

        // 第二次开始：告诉前端清掉当前 tab 内容，准备接收重写后的 delta
        if (attempt > 1) {
          send('rewrite_start', {
            platform,
            attempt,
            reason: runsForThisPlatform[runsForThisPlatform.length - 1]?.result.rewrite_hint ?? '',
          });
        }

        // 构造本轮 prompt：第一次走原 article prompt；之后把 critic hint 注入 idea 段
        const ideaForThisAttempt =
          attempt === 1
            ? idea
            : `${idea}\n\n${buildRewriteHintBlock(
                runsForThisPlatform[runsForThisPlatform.length - 1].result,
                attempt,
              )}`;
        const prompt = buildArticlePrompt(
          ideaForThisAttempt,
          composition,
          fpMap,
          outline,
          platform,
          siteCtxForThis,
          researchMaterial,
        );

        let raw = '';
        try {
          raw = await streamClaude(prompt, {
            model: ARTICLE_MODEL, // 正文走 Sonnet 4.6 降 AI 味（outline/critic 仍用默认 Opus 4.8）
            signal: abortSignal,
            timeoutMs: PER_PLATFORM_TIMEOUT_MS,
            onChunk: (text) => send('delta', { platform, delta: text, attempt }),
          });
        } catch (err) {
          const message = (err as Error).message || '模型那边没回来';
          errors.push({ platform, message });
          send('error', { platform, message, phase: 'claude', attempt });
          platformErrored = true;
          break;
        }

        const contentMd = stripMarkdownFence(raw);
        lastDraftMd = contentMd;

        // 没开 critic：直接落库走人
        if (!useCritic) break;

        // 跑 critic（同步等结果，避免落库时还没评完）
        send('critic_start', { platform, attempt });
        const critic = await runSingleCritic(
          contentMd,
          composition,
          fpMap,
          outline,
          abortSignal,
        );

        if (!critic.result) {
          // critic 自己挂了——fail-open：把本稿当作"未评估"，跳出循环用原稿落库
          send('critic_error', {
            platform,
            attempt,
            message: critic.error ?? 'critic 未知错误',
            elapsed_ms: critic.elapsed_ms,
          });
          break;
        }

        const record: CriticRunRecord = {
          attempt,
          draft_md: contentMd,
          result: critic.result,
          elapsed_ms: critic.elapsed_ms,
        };
        runsForThisPlatform.push(record);

        send('critic', {
          platform,
          attempt,
          total: critic.result.total,
          passed: critic.result.passed,
          scores: critic.result.scores,
          weakest: critic.result.weakest,
          rewrite_hint: critic.result.rewrite_hint,
          elapsed_ms: critic.elapsed_ms,
          threshold: CRITIC_PASS_THRESHOLD,
        });

        // 通过阈值 → 直接走
        if (critic.result.passed) break;
        // 还有重试机会 → 继续循环
        // 用完次数 → 走 best-of-N 兜底（在循环外）
      }

      if (platformErrored) {
        if (abortSignal.aborted) break;
        continue;
      }

      // Best-of-N 兜底：critic 用完次数仍没过阈值时，挑总分最高的那稿落库
      let finalContentMd = lastDraftMd;
      let finalAttempt = runsForThisPlatform.length;
      if (useCritic && runsForThisPlatform.length > 0) {
        const lastRun = runsForThisPlatform[runsForThisPlatform.length - 1];
        if (!lastRun.result.passed) {
          const best = pickBestRun(runsForThisPlatform);
          if (best) {
            finalContentMd = best.draft_md;
            finalAttempt = best.attempt;
            send('critic_best_of_n', {
              platform,
              picked_attempt: best.attempt,
              picked_total: best.result.total,
              all_attempts: runsForThisPlatform.length,
              threshold: CRITIC_PASS_THRESHOLD,
            });
          }
        }
      }

      perPlatformContent.set(platform, finalContentMd);
      perPlatformCriticRuns.set(platform, runsForThisPlatform);
      send('platform_done', {
        platform,
        content_md: finalContentMd,
        word_count: countWords(finalContentMd),
        is_main: isMain,
        critic_final_attempt: finalAttempt,
        critic_runs_count: runsForThisPlatform.length,
      });
    }

    // ---- 入库：主平台进 content_md，其它平台进 refine_versions_json (决策 4) ----
    const mainContent = perPlatformContent.get(mainPlatformKey) ?? '';
    let articleId: string | null = null;
    let finalTitle = body.title?.trim() || outline.working_title;

    try {
      if (mainContent) {
        const db = getDb();
        articleId = nanoid(14);
        const now = Date.now();
        const primaryFpId = composition.selected_authors[0]?.fingerprint_id ?? null;
        finalTitle =
          body.title?.trim() || extractTitleFromMarkdown(mainContent) || outline.working_title;
        const mainHtml = markdownToHtml(mainContent);

        // 其它平台收成 dict（决策 4）：{ [platform]: md }
        // 用 dict 形态而不是 refine route 的 append 数组，因为本任务是"一次出 N 版"，
        // 同一平台不会出现多版，dict 是更合适的容器。Step 7 读 refineMap 走内存，不读这列。
        const otherVersions: Record<string, string> = {};
        for (const [pk, md] of perPlatformContent.entries()) {
          if (pk === mainPlatformKey) continue;
          otherVersions[pk] = md;
        }
        const refineVersionsJson = Object.keys(otherVersions).length > 0
          ? JSON.stringify(otherVersions)
          : null;

        db.prepare(
          `INSERT INTO articles
            (id, fingerprint_id, platform_target, layout_theme, title, content_md, content_html,
             user_prompt, created_at, composition_json, outline_json, idea, refine_versions_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          articleId,
          primaryFpId,
          mainPlatformKey,
          'standard',
          finalTitle,
          mainContent,
          mainHtml,
          idea,
          now,
          JSON.stringify(composition),
          JSON.stringify(outline),
          idea,
          refineVersionsJson,
        );

        const upFp = db.prepare(`UPDATE fingerprints SET hit_count = hit_count + 1 WHERE id = ?`);
        const upAuthor = db.prepare(`UPDATE authors SET last_used_at = ? WHERE id = ?`);
        for (const sel of composition.selected_authors) {
          try { upFp.run(sel.fingerprint_id); } catch {/* ignore */}
          try { upAuthor.run(now, sel.author_id); } catch {/* ignore */}
        }

        // v3.4 · critic 评分入库（每平台每次 attempt 一行）
        // UPSERT 语义：(article_id, platform, attempt) 主键冲突时覆盖
        // —— 评测重跑时不会因为旧记录阻塞
        if (perPlatformCriticRuns.size > 0) {
          const insertCritic = db.prepare(`
            INSERT INTO critic_runs (
              article_id, platform, attempt,
              structure_score, structure_reason,
              depth_score, depth_reason,
              analogy_score, analogy_reason,
              punchline_score, punchline_reason,
              taboo_score, taboo_reason,
              total_score, passed, weakest, rewrite_hint, elapsed_ms, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(article_id, platform, attempt) DO UPDATE SET
              structure_score = excluded.structure_score,
              structure_reason = excluded.structure_reason,
              depth_score = excluded.depth_score,
              depth_reason = excluded.depth_reason,
              analogy_score = excluded.analogy_score,
              analogy_reason = excluded.analogy_reason,
              punchline_score = excluded.punchline_score,
              punchline_reason = excluded.punchline_reason,
              taboo_score = excluded.taboo_score,
              taboo_reason = excluded.taboo_reason,
              total_score = excluded.total_score,
              passed = excluded.passed,
              weakest = excluded.weakest,
              rewrite_hint = excluded.rewrite_hint,
              elapsed_ms = excluded.elapsed_ms,
              created_at = excluded.created_at
          `);
          for (const [platform, runs] of perPlatformCriticRuns.entries()) {
            for (const r of runs) {
              try {
                insertCritic.run(
                  articleId,
                  platform,
                  r.attempt,
                  r.result.scores.structure.score,
                  r.result.scores.structure.reason,
                  r.result.scores.depth.score,
                  r.result.scores.depth.reason,
                  r.result.scores.analogy.score,
                  r.result.scores.analogy.reason,
                  r.result.scores.punchline.score,
                  r.result.scores.punchline.reason,
                  r.result.scores.taboo.score,
                  r.result.scores.taboo.reason,
                  r.result.total,
                  r.result.passed ? 1 : 0,
                  r.result.weakest,
                  r.result.rewrite_hint,
                  r.elapsed_ms,
                  now,
                );
              } catch {
                // critic 入库失败不影响主流程
              }
            }
          }
        }
      } else {
        // 主平台失败的极端情况：不落库，让前端拿到 error 自己处理
      }
    } catch (err) {
      send('error', {
        message: '文章写完了，但本地数据库没接住。原文已经在内存里，复制保留一下',
        phase: 'db',
        detail: (err as Error).message,
      });
    }

    // ---- 统一 done（决策 5）----
    const allVersions: Record<string, string> = {};
    for (const [pk, md] of perPlatformContent.entries()) {
      allVersions[pk] = md;
    }
    const allWordCount = Object.values(allVersions).reduce((s, md) => s + countWords(md), 0);

    // v3.4：critic 汇总
    let criticSummary: {
      use_critic: boolean;
      total_runs: number;
      total_elapsed_ms: number;
      passed_platforms: number;
      best_of_n_platforms: number;
    } | null = null;
    if (useCritic) {
      let totalRuns = 0;
      let totalElapsed = 0;
      let passedPlatforms = 0;
      let bestOfNPlatforms = 0;
      for (const runs of perPlatformCriticRuns.values()) {
        totalRuns += runs.length;
        totalElapsed += runs.reduce((s, r) => s + r.elapsed_ms, 0);
        if (runs.length === 0) continue;
        const last = runs[runs.length - 1];
        if (last.result.passed) passedPlatforms += 1;
        else bestOfNPlatforms += 1;
      }
      criticSummary = {
        use_critic: true,
        total_runs: totalRuns,
        total_elapsed_ms: totalElapsed,
        passed_platforms: passedPlatforms,
        best_of_n_platforms: bestOfNPlatforms,
      };
    }

    send('done', {
      article_id: articleId,
      title: finalTitle,
      main_platform: mainPlatformKey,
      // 主平台 markdown 单独抛一份，兼容老 UI 单平台分支
      content_md: mainContent,
      content_html: mainContent ? markdownToHtml(mainContent) : '',
      // 所有平台 md 收成 dict 直接抛给前端，省得它再拼一次（决策 4：塞进 refineMap）
      versions: allVersions,
      all_word_count: allWordCount,
      errors,
      // v3.4：critic 评测汇总（关闭时为 null）
      critic_summary: criticSummary,
    });
  }, req.signal);
}
