import { NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { streamClaude } from '@/lib/claude';
import { buildArticlePrompt } from '@/lib/prompts/article';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingPayload {
  idea?: string;
  composition?: Composition;
  outline?: unknown;
  /** 用户提前指定的主标题（可选；如果空，从生成的 markdown 里解析） */
  title?: string;
  /** 目标平台（v3 新增）。空则走通用 wechat */
  target_platform?: string;
  /** v3.3：目标站点画像 id；传了就把站点画像注入 article prompt */
  target_site_id?: string;
}

interface SiteProfileRow {
  id: string;
  site_name: string;
  section: string | null;
  profile_json: string;
}

const MIN_IDEA_CHARS = 30;

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

  let targetPlatform: PlatformKey | null = null;
  if (typeof body.target_platform === 'string' && body.target_platform.trim()) {
    const tp = body.target_platform.trim();
    if (!isValidPlatformKey(tp)) {
      return jsonError(`目标平台 "${tp}" 不在允许列表里`);
    }
    targetPlatform = tp;
  }

  try {
    ensureComposeColumns();
  } catch (err) {
    return jsonError(`数据库结构升级失败：${(err as Error).message}`, 500);
  }

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
    send('open', { ok: true, sections: outline.sections.length });

    const prompt = buildArticlePrompt(idea, composition, fpMap, outline, targetPlatform, {
      siteLabel,
      siteProfile,
    });

    let raw = '';
    try {
      raw = await streamClaude(prompt, {
        signal: abortSignal,
        onChunk: (text) => send('chunk', { text }),
      });
    } catch (err) {
      send('error', { message: (err as Error).message || '模型那边没回来', phase: 'claude' });
      return;
    }

    const contentMd = stripMarkdownFence(raw);
    const finalTitle = (body.title?.trim()) || extractTitleFromMarkdown(contentMd) || outline.working_title;
    const contentHtml = markdownToHtml(contentMd);

    // ----- 入库 -----
    try {
      const db = getDb();
      const id = nanoid(14);
      const now = Date.now();
      const primaryFpId =
        composition.selected_authors[0]?.fingerprint_id ?? null;

      db.prepare(
        `INSERT INTO articles
          (id, fingerprint_id, platform_target, layout_theme, title, content_md, content_html,
           user_prompt, created_at, composition_json, outline_json, idea, refine_versions_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        primaryFpId,
        targetPlatform ?? 'wechat',
        'standard',
        finalTitle,
        contentMd,
        contentHtml,
        idea,
        now,
        JSON.stringify(composition),
        JSON.stringify(outline),
        idea,
        null,
      );

      // 更新被用到的指纹 hit_count + author.last_used_at
      const upFp = db.prepare(`UPDATE fingerprints SET hit_count = hit_count + 1 WHERE id = ?`);
      const upAuthor = db.prepare(`UPDATE authors SET last_used_at = ? WHERE id = ?`);
      for (const sel of composition.selected_authors) {
        try { upFp.run(sel.fingerprint_id); } catch {/* ignore */}
        try { upAuthor.run(now, sel.author_id); } catch {/* ignore */}
      }

      send('done', {
        article_id: id,
        title: finalTitle,
        content_md: contentMd,
        content_html: contentHtml,
      });
    } catch (err) {
      send('error', {
        message: '文章写完了，但本地数据库没接住。原文已经在内存里，复制保留一下',
        phase: 'db',
        detail: (err as Error).message,
        content_md: contentMd,
      });
    }
  }, req.signal);
}
