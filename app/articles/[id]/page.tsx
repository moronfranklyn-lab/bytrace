import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';
import { getDb } from '@/lib/db';
import { ArticleDeleteButton } from './ArticleDeleteButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  title: string | null;
  content_md: string | null;
  content_html: string | null;
  user_prompt: string | null;
  platform_target: string | null;
  layout_theme: string | null;
  created_at: number;
  fingerprint_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 把 markdown 简单渲染成 HTML 块（避免引依赖）。仅做：
 * - # / ## 当标题
 * - 段落分隔（空行）
 * - 列表（- xxx）
 * 不支持加粗 / 链接 / 图片，反正这页只是回顾。
 */
function renderMarkdownLite(md: string): string {
  const blocks = md.split(/\n\s*\n/);
  const html: string[] = [];
  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    if (b.startsWith('# ')) {
      html.push(`<h1 class="article-md-h1">${escape(b.slice(2).trim())}</h1>`);
    } else if (b.startsWith('## ')) {
      html.push(`<h2 class="article-md-h2">${escape(b.slice(3).trim())}</h2>`);
    } else if (b.startsWith('### ')) {
      html.push(`<h3 class="article-md-h3">${escape(b.slice(4).trim())}</h3>`);
    } else if (/^[-*]\s+/.test(b)) {
      const items = b
        .split('\n')
        .filter((l) => /^[-*]\s+/.test(l))
        .map((l) => `<li>${escape(l.replace(/^[-*]\s+/, ''))}</li>`)
        .join('');
      html.push(`<ul class="article-md-ul">${items}</ul>`);
    } else if (b.startsWith('> ')) {
      html.push(`<blockquote class="article-md-quote">${escape(b.slice(2))}</blockquote>`);
    } else {
      html.push(`<p>${escape(b).replace(/\n/g, '<br/>')}</p>`);
    }
  }
  return html.join('\n');
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT art.id, art.title, art.content_md, art.content_html, art.user_prompt,
              art.platform_target, art.layout_theme, art.created_at, art.fingerprint_id,
              a.name AS author_name, a.avatar_emoji AS author_avatar
       FROM articles art
       LEFT JOIN fingerprints f ON f.id = art.fingerprint_id
       LEFT JOIN authors a ON a.id = f.author_id
       WHERE art.id = ?`,
    )
    .get(id) as Row | undefined;

  if (!row) {
    notFound();
  }

  const title = row.title?.trim() || '（无标题草稿）';
  const layoutKey =
    row.layout_theme === 'lively' || row.layout_theme === 'minimal'
      ? row.layout_theme
      : 'standard';

  // content_html 优先；没有就把 content_md 走 mini renderer；都没有就显示 user_prompt 草稿
  let bodyHtml = '';
  if (row.content_html && row.content_html.trim()) {
    bodyHtml = row.content_html;
  } else if (row.content_md && row.content_md.trim()) {
    bodyHtml = renderMarkdownLite(row.content_md);
  } else {
    bodyHtml = `<p class="article-empty-body">这篇还没有正文，只有思路：</p><blockquote class="article-md-quote">${escape(row.user_prompt || '')}</blockquote>`;
  }

  return (
    <>
      <HomeNav activePath="/articles" />
      <main className="container article-detail-page" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div className="article-detail-head">
          <div className="article-detail-meta-row">
            <Link href="/articles" className="article-detail-back">← 回历史列表</Link>
            <span className="article-detail-date">{fmtDate(row.created_at)}</span>
          </div>
          <h1 className="article-detail-title">{title}</h1>
          <div className="article-detail-tags">
            {row.author_name && row.fingerprint_id && (
              <Link href={`/fingerprints/${row.fingerprint_id}`} className="tag tag-lang">
                {row.author_avatar || row.author_name.slice(0, 1)} · {row.author_name} 风
              </Link>
            )}
            {row.platform_target && (
              <span className="tag">{row.platform_target}</span>
            )}
            {row.layout_theme && (
              <span className="tag tag-struct">{row.layout_theme}</span>
            )}
          </div>
          <div className="article-detail-actions">
            <Link href={`/compose?article=${row.id}`} className="btn btn-secondary">
              编辑这篇
            </Link>
            {row.fingerprint_id && (
              <Link
                href={`/compose?fingerprint=${row.fingerprint_id}`}
                className="btn btn-secondary"
              >
                按这个风格重写
              </Link>
            )}
            <ArticleDeleteButton id={row.id} title={title} />
          </div>
        </div>

        <article
          className="article article-detail-body"
          data-layout={layoutKey}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        {row.user_prompt && (
          <details className="raw-json-panel">
            <summary className="raw-json-summary">
              <span>当时的写作思路（user_prompt）</span>
              <span style={{ fontSize: 10 }}>展开 ▾</span>
            </summary>
            <pre className="raw-json-body">{row.user_prompt}</pre>
          </details>
        )}
      </main>
    </>
  );
}
