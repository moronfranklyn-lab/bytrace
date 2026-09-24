import { readdirSync, statSync } from 'node:fs';
import { extname, join, basename, relative, dirname, sep } from 'node:path';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { envStr } from '@/lib/env';

/**
 * 默认素材库根目录。
 *
 * 解析顺序：
 *   1. BYTRACE_ASSETS_ROOT（推荐：在 .env.local 指定自己的图片目录）
 *   2. <repo>/data/assets（仓库内自带的素材目录，开箱可用）
 *
 * 不硬编码任何机器路径，因此在别人的电脑上也能直接跑起来。
 */
export function defaultLocalAssetsRoot(): string {
  const configured = envStr('BYTRACE_ASSETS_ROOT');
  if (configured) return configured;
  return join(process.cwd(), 'data', 'assets');
}

export const DEFAULT_LOCAL_ASSETS_ROOT = defaultLocalAssetsRoot();

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export interface ScanResult {
  scanned: number;
  inserted: number;
  skipped_existing: number;
  errors: { path: string; message: string }[];
  root: string;
}

/**
 * Recursively walk a directory and yield absolute file paths.
 * Skips dotfiles (e.g. .DS_Store) and node_modules-y noise.
 */
function* walkFiles(root: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkFiles(full);
    } else if (st.isFile()) {
      yield full;
    }
  }
}

/**
 * Strip extension and trailing numeric/hash junk from a filename so it can be
 * used as a tag. e.g. "微信图片_20260502000538_4_16.png" → ["微信图片"].
 */
function deriveTagsFromName(fileName: string): string[] {
  const base = basename(fileName, extname(fileName));
  // Split on common separators.
  const parts = base
    .split(/[_\-\s.]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Drop pure-numeric / hash-like fragments.
  const meaningful = parts.filter((p) => {
    if (/^\d+$/.test(p)) return false;
    if (/^[0-9a-f]{12,}$/i.test(p)) return false;
    if (p.length === 1) return false;
    return true;
  });
  return meaningful.slice(0, 4);
}

/**
 * Use the immediate parent folder name (relative to scan root) as a tag.
 * For files directly under root we return [] so tags come purely from the
 * filename.
 */
function deriveFolderTags(absPath: string, root: string): string[] {
  const rel = relative(root, absPath);
  const dir = dirname(rel);
  if (!dir || dir === '.' || dir === '') return [];
  // Split nested folders, drop leading "1." numeric prefixes.
  return dir
    .split(sep)
    .map((seg) => seg.replace(/^\d+[._\-\s]+/, '').trim())
    .filter(Boolean);
}

/**
 * Build the initial tag set for an asset using folder + filename heuristics.
 * 247 张图都没有 alt 文本，文件夹/文件名是我们唯一能用的信号。
 */
export function buildInitialTags(absPath: string, root: string): string[] {
  const folderTags = deriveFolderTags(absPath, root);
  const nameTags = deriveTagsFromName(basename(absPath));
  // De-duplicate while preserving order.
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const t of [...folderTags, ...nameTags]) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }
  return merged;
}

/**
 * Heuristic visual_style guess from filename / folder hints.
 * 没法真做视觉分析，只能猜个大概。
 */
export function guessVisualStyle(absPath: string): string {
  const lower = absPath.toLowerCase();
  if (lower.includes('snipaste') || lower.includes('screenshot') || lower.includes('截图')) {
    return '截图';
  }
  if (lower.includes('jimeng') || lower.includes('chibi') || lower.includes('插画') || lower.includes('illustration')) {
    return '插画';
  }
  if (lower.includes('chart') || lower.includes('数据') || lower.includes('graph')) {
    return '数据图';
  }
  return '其他';
}

interface ExistingRow {
  id: string;
  file_path: string;
}

/**
 * Scan a directory and insert image rows into `local_assets`.
 * Existing rows (matched by file_path UNIQUE) are skipped.
 *
 * 不读 EXIF 不调 sharp / image-size。size_bytes 用 fs.statSync 拿，
 * width/height 留 null —— 工程约束。
 */
export function scanDirectory(root: string = DEFAULT_LOCAL_ASSETS_ROOT): ScanResult {
  const result: ScanResult = {
    scanned: 0,
    inserted: 0,
    skipped_existing: 0,
    errors: [],
    root,
  };

  const db = getDb();

  // Pre-load all existing file_paths so we can skip in O(1) without N round-trips.
  const existing = db
    .prepare('SELECT id, file_path FROM local_assets')
    .all() as ExistingRow[];
  const existingSet = new Set(existing.map((r) => r.file_path));

  const insert = db.prepare(
    `INSERT INTO local_assets
      (id, file_path, file_name, folder, width, height, size_bytes,
       tags_json, visual_style, source, source_url, indexed_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = Date.now();
  const rows: unknown[][] = [];

  for (const absPath of walkFiles(root)) {
    result.scanned += 1;

    const ext = extname(absPath).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    if (existingSet.has(absPath)) {
      result.skipped_existing += 1;
      continue;
    }

    let sizeBytes: number | null = null;
    try {
      sizeBytes = statSync(absPath).size;
    } catch (err) {
      result.errors.push({
        path: absPath,
        message: `stat failed: ${(err as Error).message}`,
      });
      continue;
    }

    const tags = buildInitialTags(absPath, root);
    const folder = relative(root, dirname(absPath)) || null;
    const visualStyle = guessVisualStyle(absPath);

    rows.push([
      nanoid(14),
      absPath,
      basename(absPath),
      folder,
      null, // width
      null, // height
      sizeBytes,
      JSON.stringify(tags),
      visualStyle,
      'local',
      null, // source_url
      now,
    ]);
  }

  // Bulk insert in one transaction for atomicity + speed.
  if (rows.length > 0) {
    const tx = db.transaction((batch: unknown[][]) => {
      for (const r of batch) {
        try {
          insert.run(...r);
          result.inserted += 1;
        } catch (err) {
          result.errors.push({
            path: String(r[1]),
            message: (err as Error).message,
          });
        }
      }
    });
    tx(rows);
  }

  return result;
}
