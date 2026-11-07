import { getDb } from '@/lib/db';

export interface LocalAsset {
  id: string;
  file_path: string;
  file_name: string | null;
  folder: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  tags: string[];
  visual_style: string | null;
  source: string;
  source_url: string | null;
  indexed_at: number;
}

interface RawRow {
  id: string;
  file_path: string;
  file_name: string | null;
  folder: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  tags_json: string | null;
  visual_style: string | null;
  source: string;
  source_url: string | null;
  indexed_at: number;
}

function rowToAsset(row: RawRow): LocalAsset {
  let tags: string[] = [];
  if (row.tags_json) {
    try {
      const parsed = JSON.parse(row.tags_json);
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      // ignore malformed tag JSON
    }
  }
  return {
    id: row.id,
    file_path: row.file_path,
    file_name: row.file_name,
    folder: row.folder,
    width: row.width,
    height: row.height,
    size_bytes: row.size_bytes,
    tags,
    visual_style: row.visual_style,
    source: row.source,
    source_url: row.source_url,
    indexed_at: row.indexed_at,
  };
}

/**
 * Score an asset against a list of query keywords.
 * Match against folder + filename + tags. Case-insensitive substring.
 */
function scoreAsset(asset: LocalAsset, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = [
    asset.folder ?? '',
    asset.file_name ?? '',
    asset.visual_style ?? '',
    ...asset.tags,
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const kw of keywords) {
    const k = kw.trim().toLowerCase();
    if (!k) continue;
    if (haystack.includes(k)) score += 2;
    // tag exact-ish match gets a small bonus
    if (asset.tags.some((t) => t.toLowerCase() === k)) score += 1;
  }
  return score;
}

/**
 * Search the local asset library by free-form keywords.
 * Returns top N matches sorted by score, then by recency.
 * If `keywords` is empty, returns most recently indexed assets.
 */
export function searchLocalAssets(
  keywords: string[],
  limit: number = 10,
): LocalAsset[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, file_path, file_name, folder, width, height, size_bytes,
              tags_json, visual_style, source, source_url, indexed_at
       FROM local_assets
       ORDER BY indexed_at DESC`,
    )
    .all() as RawRow[];

  const assets = rows.map(rowToAsset);

  if (keywords.length === 0) {
    return assets.slice(0, limit);
  }

  const scored = assets
    .map((a) => ({ a, s: scoreAsset(a, keywords) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);

  return scored.slice(0, limit).map((x) => x.a);
}

/**
 * Count total assets. Used by ImagePanel "247 张已打标" status line.
 */
export function countLocalAssets(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as n FROM local_assets').get() as {
    n: number;
  };
  return row?.n ?? 0;
}

export function getLocalAssetById(id: string): LocalAsset | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, file_path, file_name, folder, width, height, size_bytes,
              tags_json, visual_style, source, source_url, indexed_at
       FROM local_assets WHERE id = ?`,
    )
    .get(id) as RawRow | undefined;
  if (!row) return null;
  return rowToAsset(row);
}
