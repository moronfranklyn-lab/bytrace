import { NextRequest } from 'next/server';
import { listSettings, setSetting } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Agent M · 全局偏好设置 API。
 *
 * GET    /api/settings           列出所有 key/value
 * PATCH  /api/settings           body: { key, value }，写入数据库
 *
 * 当前只接受白名单内的 key（default_theme），其他一律 400。
 */

const ALLOWED_KEYS = new Set(['default_theme', 'apify_token']);

// 每个 key 自带值校验，防止前端误传。
const VALUE_VALIDATORS: Record<string, (v: string) => boolean> = {
  default_theme: (v) => ['B', 'C', 'D'].includes(v),
  // Apify token 形如 apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxx；空字符串视为清除
  apify_token: (v) => v === '' || /^apify_api_[A-Za-z0-9]{20,}$/.test(v),
};

export async function GET() {
  try {
    const all = listSettings();
    return Response.json(all);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function PATCH(req: NextRequest) {
  let body: { key?: unknown; value?: unknown };
  try {
    body = (await req.json()) as { key?: unknown; value?: unknown };
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  // value 允许是空字符串（用于清除某个设置，例如禁用 Apify 时清空 token）
  const value = typeof body.value === 'string' ? body.value.trim() : '';

  if (!key) {
    return Response.json({ error: 'key 不能为空' }, { status: 400 });
  }
  if (!ALLOWED_KEYS.has(key)) {
    return Response.json({ error: `不允许写入 key=${key}` }, { status: 400 });
  }
  const validator = VALUE_VALIDATORS[key];
  if (validator && !validator(value)) {
    return Response.json(
      { error: `key=${key} 的取值 ${value} 不在允许范围内` },
      { status: 400 },
    );
  }

  try {
    setSetting(key, value);
    return Response.json({ ok: true, key, value });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
