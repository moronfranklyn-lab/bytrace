import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ensureComposeColumns } from '@/lib/compose-schema';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WechatDraft {
  title: string;
  content_html: string;
  create_time: number;
  update_time: number;
}

interface ImportRequest {
  drafts: WechatDraft[];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImportRequest;
    const drafts = body.drafts || [];

    if (!Array.isArray(drafts) || drafts.length === 0) {
      return NextResponse.json({ error: '没有提供草稿数据' }, { status: 400 });
    }

    ensureComposeColumns();
    const db = getDb();

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const draft of drafts) {
      try {
        const title = draft.title?.trim() || '（无标题）';

        // 检查是否已存在（通过标题判断）
        const existing = db
          .prepare('SELECT id FROM articles WHERE title = ?')
          .get(title);

        if (existing) {
          skipped++;
          continue;
        }

        // 将 HTML 转换为简单的 Markdown（基础转换）
        const content_md = htmlToMarkdown(draft.content_html || '');

        const id = nanoid(14);
        const now = Date.now();

        db.prepare(
          `INSERT INTO articles (
            id, title, content_md, platform_target,
            created_at, user_prompt
          ) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          title,
          content_md,
          'wechat',
          draft.update_time || now,
          `从公众号草稿箱导入于 ${new Date().toLocaleString()}`
        );

        imported++;
      } catch (err) {
        errors.push(`导入《${draft.title}》失败: ${(err as Error).message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      imported,
      skipped,
      errors: errors.slice(0, 10),
      message: `成功导入 ${imported} 篇，跳过 ${skipped} 篇重复`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `导入失败: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

// 简单的 HTML 转 Markdown（基础版）
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
