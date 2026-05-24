/**
 * Unsplash adapter. Optional — if UNSPLASH_ACCESS_KEY is not set, every call
 * gracefully returns an empty array so the UI just falls back to the local
 * library + crawled stash. No throws.
 */

export interface UnsplashPhoto {
  id: string;
  url: string;            // regular size, suitable for article body
  thumb_url: string;      // small size, for the picker grid
  download_url: string;   // full size, recorded for attribution
  alt: string | null;
  author: string | null;
  author_url: string | null;
  source: 'unsplash';
}

const UNSPLASH_API = 'https://api.unsplash.com/search/photos';

function getAccessKey(): string | null {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

interface RawUnsplashPhoto {
  id: string;
  alt_description: string | null;
  description: string | null;
  urls: {
    regular: string;
    small: string;
    full: string;
  };
  user: {
    name: string;
    links: { html: string };
  };
}

export async function searchUnsplash(
  query: string,
  count: number = 5,
): Promise<UnsplashPhoto[]> {
  const accessKey = getAccessKey();
  if (!accessKey) {
    return [];
  }
  const q = (query ?? '').trim();
  if (!q) return [];

  const url = new URL(UNSPLASH_API);
  url.searchParams.set('query', q);
  url.searchParams.set('per_page', String(Math.max(1, Math.min(count, 20))));
  // Prefer landscape — better fit for article bodies than portrait phone shots.
  url.searchParams.set('orientation', 'landscape');

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      },
      // Unsplash search is fast; cap it so a slow network doesn't block /api/images/auto.
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Network error / timeout / DNS — treat as "no results", don't blow up.
    return [];
  }

  if (!res.ok) {
    // Bad key, rate limit, etc. Surface empty instead of throwing so the
    // composer keeps working with local-only.
    return [];
  }

  let body: { results?: RawUnsplashPhoto[] };
  try {
    body = (await res.json()) as { results?: RawUnsplashPhoto[] };
  } catch {
    return [];
  }

  const results = Array.isArray(body.results) ? body.results : [];
  return results.map((r): UnsplashPhoto => ({
    id: r.id,
    url: r.urls.regular,
    thumb_url: r.urls.small,
    download_url: r.urls.full,
    alt: r.alt_description ?? r.description ?? null,
    author: r.user?.name ?? null,
    author_url: r.user?.links?.html ?? null,
    source: 'unsplash',
  }));
}

/**
 * True iff UNSPLASH_ACCESS_KEY is configured. UIs use this to render a hint
 * like "未配置 Unsplash key —— 仅本地匹配".
 */
export function isUnsplashConfigured(): boolean {
  return getAccessKey() !== null;
}
