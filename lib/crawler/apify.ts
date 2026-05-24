/**
 * Apify HTTP 客户端 + 4 个平台专用 Actor 调用。
 *
 * 设计原则：
 * - Token 来源优先级：DB settings (apify_token) → process.env.APIFY_TOKEN
 * - 没 token → 全部函数返回 null，调用方走回退逻辑
 * - 走 run-sync-get-dataset-items，一次请求拿到结果，不轮询
 * - 单次调用 timeout=150s（Actor 内部上限 120s + 网络余量）
 * - 失败降级为 null，让上层 adapter 走 cheerio/blocked 兜底
 * - 成功时返回 { items, runId, costUsd }，调用方可上报 toast
 *
 * 已实测可用的 Actor（截至 2026-05-24）：
 *   sian.agency/zhihu-scraper                     —— 知乎文章全文
 *   sian.agency/bilibili-video-scraper            —— B 站视频元数据 + 字幕 URL
 *   sian.agency/wechat-official-accounts-scraper  —— 公众号正文
 *   zhorex/rednote-xiaohongshu-scraper            —— 小红书搜索/笔记详情
 */

import got from 'got';
import { getSetting } from '@/lib/db';

const APIFY_BASE = 'https://api.apify.com/v2';
const RUN_TIMEOUT_MS = 150_000;
const ACTOR_TIMEOUT_SECS = 120;
const ACTOR_MEMORY_MB = 1024;

/** 单次 Actor 调用的成果数据（成功时） */
export type ApifyRunResult<T> = {
  items: T[];
  runId: string;
  /** 本次跑了多少美元（按 Apify 计费），无运行信息时为 0 */
  costUsd: number;
};

/** 取当前可用 token：DB 优先，env 兜底；都没有返回 null。 */
export function getApifyToken(): string | null {
  try {
    const fromDb = getSetting('apify_token');
    if (fromDb && fromDb.trim()) return fromDb.trim();
  } catch {
    // DB 读不到（构建期等）静默走 env
  }
  const fromEnv = process.env.APIFY_TOKEN;
  return fromEnv ? fromEnv.trim() : null;
}

export function isApifyEnabled(): boolean {
  return !!getApifyToken();
}

/**
 * 通用 run-sync 调用。
 * 失败返回 null（不抛错），由调用方走回退。
 * 成功返回 { items, runId, costUsd }。
 */
async function runActor<T = Record<string, unknown>>(
  actorSlug: string,
  input: Record<string, unknown>,
): Promise<ApifyRunResult<T> | null> {
  const token = getApifyToken();
  if (!token) return null;

  // 用 run-sync-get-dataset-items 一步出数据；但 cost 信息只在 /v2/actor-runs/{id} 才有。
  // 所以走两步：先 runs（非 sync）拿 runId → 再 get-items → 再查 run 详情拿 cost。
  // 但 sync 接口更稳定，权衡：用 sync 拿 items + header 里的 X-Apify-Run-Id，再异步查 cost。
  const url = `${APIFY_BASE}/acts/${actorSlug}/run-sync-get-dataset-items?timeout=${ACTOR_TIMEOUT_SECS}&memory=${ACTOR_MEMORY_MB}`;

  try {
    const res = await got.post(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      json: input,
      timeout: { request: RUN_TIMEOUT_MS },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'json',
    });

    if (res.statusCode >= 400) return null;
    const body = res.body as unknown;
    if (!Array.isArray(body) || body.length === 0) return null;

    const runId = String(res.headers['x-apify-run-id'] || '');
    // Apify 的 usageTotalUsd 是异步结算，sync 接口返回时通常还是 0。
    // 先拿真实值；为 0 就按 actor 取一个保守的估算值（典型成本中位数），
    // 让 toast 至少显示个量级，账户余额 pill 会在轮询时拿到准确值。
    const realCost = runId ? await fetchRunCost(runId, token) : 0;
    const costUsd = realCost > 0 ? realCost : estimateActorCost(actorSlug);

    return { items: body as T[], runId, costUsd };
  } catch {
    return null;
  }
}

/** sync run 时 usageTotalUsd 常为 0，按 actor 给个粗估，让 UI 有显示。 */
function estimateActorCost(actorSlug: string): number {
  // 单 run 单 item 的预估（实测后修正于 2026-05-24）：
  //   sian.agency 系列 = $0.14 startup + $0.09-0.39 per-item，总 $0.23-0.53
  //   zhorex / habit.zhou = per-item 主导 ≈ $0.005-0.015，无显著 startup
  // 批量调用时这个值不准（应按 items 数线性叠加），调用方拿不到 dataset 大小，
  // 只能给单条估值；真实计费由 Apify usageTotalUsd 在下一轮 pill 刷新时显示。
  if (actorSlug.startsWith('sian.agency~zhihu')) return 0.26;
  if (actorSlug.startsWith('sian.agency~bilibili')) return 0.26;
  if (actorSlug.startsWith('sian.agency~wechat')) return 0.53;
  if (actorSlug.startsWith('zhorex~bilibili')) return 0.005;
  if (actorSlug.startsWith('zhorex~rednote')) return 0.005;
  return 0.01;
}

/** 查单次 run 的 usageUsd（计费金额）。失败返回 0。 */
async function fetchRunCost(runId: string, token: string): Promise<number> {
  try {
    const res = await got(`${APIFY_BASE}/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: { request: 8_000 },
      retry: { limit: 0 },
      throwHttpErrors: false,
      responseType: 'json',
    });
    if (res.statusCode >= 400) return 0;
    const body = res.body as { data?: { usageTotalUsd?: number; usageUsd?: number } };
    return Number(body?.data?.usageTotalUsd || body?.data?.usageUsd || 0);
  } catch {
    return 0;
  }
}

// ============================================================================
// 知乎
// ============================================================================

export type ApifyZhihuArticle = {
  articleId: string;
  title: string;
  content: string;
  excerpt?: string;
  authorName?: string;
  url: string;
};

/** 知乎文章详情（zhuanlan.zhihu.com/p/{id}）。content 是 HTML 全文。 */
export async function fetchZhihuArticle(
  articleId: string,
): Promise<ApifyRunResult<unknown> & { article: ApifyZhihuArticle } | null> {
  const r = await runActor<Record<string, unknown>>('sian.agency~zhihu-scraper', {
    operation: 'articleDetail',
    articleId,
  });
  if (!r) return null;
  const it = r.items[0];
  const content = String(it.content || '');
  if (content.length < 60) return null;
  return {
    ...r,
    article: {
      articleId: String(it.articleId || it.id || articleId),
      title: String(it.title || it.articleTitle || ''),
      content,
      excerpt: typeof it.excerpt === 'string' ? it.excerpt : undefined,
      authorName: typeof it.authorName === 'string' ? it.authorName : undefined,
      url: `https://zhuanlan.zhihu.com/p/${articleId}`,
    },
  };
}

// ============================================================================
// B 站
// ============================================================================

export type ApifyBilibiliVideo = {
  bvid: string;
  aid: string;
  cid: string;
  title: string;
  desc: string;
  ownerName: string;
  ownerFace: string;
  pic: string;
};

export type ApifyBilibiliCaption = {
  text: string;
  language: string;
  isAi: boolean;
};

/**
 * B 站视频元数据（**单条调用，保留向后兼容**）。
 *
 * 内部走 zhorex/bilibili-scraper 而非贵 5×的 sian.agency。
 * zhorex 的 video_detail 返回包含元数据 + 字幕文本（已合并），不再需要额外的 caption 调用。
 *
 * 想拆解多个视频时优先用 fetchBilibiliVideosBatch（单 run 多 item 摊薄成本）。
 */
export async function fetchBilibiliVideo(
  bvid: string,
): Promise<ApifyRunResult<unknown> & { video: ApifyBilibiliVideo; captionText: string } | null> {
  const batch = await fetchBilibiliVideosBatch([bvid]);
  if (!batch || batch.videos.length === 0) return null;
  return {
    items: batch.items,
    runId: batch.runId,
    costUsd: batch.costUsd,
    video: batch.videos[0],
    captionText: batch.captions[0] ?? '',
  };
}

/**
 * B 站视频批量元数据（一次 run 拿多个）。
 *
 * 传 BV ID 或完整 URL 都行（zhorex actor 内部会归一化）。
 * 返回的 videos / captions 数组**按输入顺序对齐**，缺失的位置是 null/''。
 */
export async function fetchBilibiliVideosBatch(
  bvidsOrUrls: string[],
): Promise<
  | (ApifyRunResult<Record<string, unknown>> & {
      videos: ApifyBilibiliVideo[];
      captions: string[];
    })
  | null
> {
  if (bvidsOrUrls.length === 0) return null;
  const r = await runActor<Record<string, unknown>>('zhorex~bilibili-scraper', {
    mode: 'video_detail',
    videoUrls: bvidsOrUrls,
    maxResults: Math.max(bvidsOrUrls.length, 1),
  });
  if (!r) return null;

  // zhorex 的输出按输入顺序，但保险起见用 bvid 反查对齐
  const byBvid = new Map<string, Record<string, unknown>>();
  for (const it of r.items) {
    const bv = String(it.bvid || it.BV || '');
    if (bv) byBvid.set(bv, it);
  }

  const videos: ApifyBilibiliVideo[] = [];
  const captions: string[] = [];
  for (const input of bvidsOrUrls) {
    const bv = extractBvid(input);
    const it = (bv && byBvid.get(bv)) || r.items[videos.length] || null;
    if (!it) {
      // 用占位让数组长度对齐
      videos.push({
        bvid: bv || '',
        aid: '',
        cid: '',
        title: '',
        desc: '',
        ownerName: '',
        ownerFace: '',
        pic: '',
      });
      captions.push('');
      continue;
    }
    const owner = (it.owner as Record<string, unknown> | undefined) || {};
    videos.push({
      bvid: String(it.bvid || bv || ''),
      aid: String(it.aid || ''),
      cid: String(it.cid || ''),
      title: String(it.title || ''),
      desc: String(it.desc || it.description || ''),
      ownerName: String(owner.name || it.ownerName || ''),
      ownerFace: String(owner.face || ''),
      pic: String(it.pic || it.cover || ''),
    });
    // zhorex 的字幕字段可能叫 subtitle / subtitles / caption / transcript
    captions.push(
      String(it.subtitle || it.subtitles || it.caption || it.transcript || ''),
    );
  }
  return { ...r, videos, captions };
}

function extractBvid(s: string): string | null {
  const m = s.match(/BV[0-9A-Za-z]{10}/);
  return m ? m[0] : null;
}

/**
 * @deprecated zhorex 的 video_detail 已经直接返回 caption，无需单独调。
 * 保留只是为了让现有 bilibili adapter 不立即 break；下一轮重构会删除。
 */
export async function fetchBilibiliCaption(
  _bvid: string,
  _aid: string,
  _cid: string,
): Promise<ApifyRunResult<unknown> & { caption: ApifyBilibiliCaption | null } | null> {
  // 直接返回 null，让 adapter 走 captionText 字段（fetchBilibiliVideo 已带）
  return null;
}

function mergeSubtitleLines(
  lines: Array<{ from?: number; to?: number; content?: string }>,
): string {
  const paragraphs: string[] = [];
  let current = '';
  let lastTo = 0;
  for (const line of lines) {
    const text = (line.content || '').trim();
    if (!text) continue;
    const gap = (line.from || 0) - lastTo;
    if (current && (gap > 1.5 || /[。！？!?\.…]$/.test(current))) {
      paragraphs.push(current.trim());
      current = text;
    } else {
      const needsSpace = !(/[一-鿿]/.test(current.slice(-1)) && /[一-鿿]/.test(text[0] || ''));
      current = current ? current + (needsSpace ? ' ' : '') + text : text;
    }
    lastTo = line.to || 0;
  }
  if (current.trim()) paragraphs.push(current.trim());
  return paragraphs.join('\n\n');
}

// ============================================================================
// 公众号
// ============================================================================

export type ApifyWechatArticle = {
  url: string;
  title: string;
  content: string;
  authorName: string;
  publishTime: string;
};

/** 公众号文章正文。content 是 markdown 化的纯文本，比手贴还干净。 */
export async function fetchWechatArticle(
  articleUrl: string,
): Promise<ApifyRunResult<unknown> & { article: ApifyWechatArticle } | null> {
  const r = await runActor<Record<string, unknown>>(
    'sian.agency~wechat-official-accounts-scraper',
    {
      operation: 'articleDetail',
      articleUrl,
    },
  );
  if (!r) return null;
  const it = r.items[0];
  const content = String(it.content || '');
  if (content.length < 60) return null;
  const userInfo = (it.user_info as Record<string, unknown> | undefined) || {};
  return {
    ...r,
    article: {
      url: String(it.articleUrl || articleUrl),
      title: String(it.title || ''),
      content,
      authorName: String(
        it.accountNickname || it.nickname || userInfo.nickname || userInfo.author || '',
      ),
      publishTime: String(it.publish_time || it.publishDate || ''),
    },
  };
}

// ============================================================================
// 小红书
// ============================================================================

export type ApifyXiaohongshuPost = {
  postId: string;
  postUrl: string;
  title: string;
  content: string;
  authorName: string;
  likes: number;
};

/** 小红书笔记详情（单条；内部委托给 batch 版本，单 run 摊薄启动费）。 */
export async function fetchXiaohongshuPost(
  postUrl: string,
): Promise<ApifyRunResult<unknown> & { post: ApifyXiaohongshuPost } | null> {
  const batch = await fetchXiaohongshuPostsBatch([postUrl]);
  if (!batch || batch.posts.length === 0) return null;
  const post = batch.posts[0];
  if (!post) return null;
  return {
    items: batch.items,
    runId: batch.runId,
    costUsd: batch.costUsd,
    post,
  };
}

/**
 * 小红书笔记批量详情（一次 run 多个 URL）。
 *
 * 返回的 posts 数组**按输入顺序对齐**；某条爬不到（normalize 后 content 太短）位置是 null。
 */
export async function fetchXiaohongshuPostsBatch(
  postUrls: string[],
): Promise<
  | (ApifyRunResult<Record<string, unknown>> & { posts: Array<ApifyXiaohongshuPost | null> })
  | null
> {
  if (postUrls.length === 0) return null;
  const r = await runActor<Record<string, unknown>>('zhorex~rednote-xiaohongshu-scraper', {
    mode: 'post_details',
    postUrls,
    maxResults: Math.max(postUrls.length, 1),
  });
  if (!r) return null;

  // 用 postId（从 URL 抽）做对齐
  const byId = new Map<string, Record<string, unknown>>();
  for (const it of r.items) {
    const id = String(it.postId || extractXhsPostId(String(it.postUrl || '')) || '');
    if (id) byId.set(id, it);
  }

  const posts: Array<ApifyXiaohongshuPost | null> = postUrls.map((url, idx) => {
    const id = extractXhsPostId(url);
    const it = (id && byId.get(id)) || r.items[idx] || null;
    if (!it) return null;
    const content = String(it.content || '');
    if (content.length < 30) return null;
    const author = (it.author as Record<string, unknown> | undefined) || {};
    return {
      postId: String(it.postId || id || ''),
      postUrl: String(it.postUrl || url),
      title: String(it.title || ''),
      content,
      authorName: String(it.authorName || author.nickname || ''),
      likes: Number(it.likes || 0),
    };
  });
  return { ...r, posts };
}

function extractXhsPostId(url: string): string | null {
  const m = url.match(/\/explore\/([a-f0-9]{20,})/i);
  return m ? m[1] : null;
}

/** 小红书博主笔记列表。 */
export async function fetchXiaohongshuUserPosts(
  userProfileUrl: string,
  maxResults = 30,
): Promise<ApifyRunResult<unknown> & { authorName: string | null; postUrls: string[] } | null> {
  const r = await runActor<Record<string, unknown>>('zhorex~rednote-xiaohongshu-scraper', {
    mode: 'user_posts',
    userUrl: userProfileUrl,
    maxResults,
  });
  if (!r) return null;
  const postUrls: string[] = [];
  let authorName: string | null = null;
  for (const it of r.items) {
    const url = String(it.postUrl || '');
    if (url) postUrls.push(url);
    if (!authorName && it.authorName) authorName = String(it.authorName);
  }
  if (postUrls.length === 0) return null;
  return { ...r, authorName, postUrls };
}
