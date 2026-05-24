/**
 * 风格融合（Composition）
 * ------------------------------------------------------------
 * 用户在 /compose Step 2-3 选择 / 调整出来的"风格组合"，会被序列化
 * 进 articles.composition_json，并在写大纲 / 写正文的 prompt 里被
 * `buildCompositionSystemSnippet` 还原成 system 段落塞进 Claude。
 *
 * 设计原则：
 * - 单博主权重 1.0 时退化为"完全模仿 X"。
 * - 多博主权重之和 ≠ 1 也允许，prompt 里会把"占比 N%"直接告诉模型，
 *   不在前端做归一化（避免 0.33/0.33/0.34 这种丑陋小数）。
 * - 用户可选只用某博主的"部分维度"（use_strategies），常用于
 *   "我要他的开篇 + 你的论证 + 第三个人的收尾"。
 */

export interface CompositionAuthor {
  /** authors.id */
  author_id: string;
  /** fingerprints.id */
  fingerprint_id: string;
  /** 0-1，由前端 slider 控制；prompt 里转成百分比 */
  weight: number;
  /**
   * 可选：只取该博主的部分维度。允许值是 fingerprint JSON 的顶层 key：
   * 'language' | 'structure' | 'topic' | 'visual' | 'do_list' | 'dont_list'
   * 不传则全维度生效。
   */
  use_strategies?: string[];
}

export interface Composition {
  selected_authors: CompositionAuthor[];
  /** 用户自己加的调整说明，原样回灌到 prompt */
  custom_notes?: string;
}

/** 指纹 JSON 的最小形状，使用宽松类型避免和 fingerprint 维护脱钩 */
export interface FingerprintShape {
  author_summary?: string;
  language?: unknown;
  structure?: unknown;
  topic?: unknown;
  visual?: unknown;
  fingerprint_summary?: string;
  do_list?: unknown;
  dont_list?: unknown;
  verbal_tics?: unknown;
  // ===== v3 新增字段（可选，无则降级到 v1/v2 路径）=====
  platforms_analyzed?: string[];
  domains_analyzed?: string[];
  platform_fingerprints?: Record<string, unknown>;
  domain_variations?: Record<string, unknown>;
  cross_platform_report?: {
    summary?: string;
    comparisons?: Array<Record<string, unknown>>;
    transferable_patterns?: string[];
  };
  strategy_fragments?: Array<{
    tag?: string;
    platform_scope?: string[];
    domain_scope?: string[];
    title?: string;
    description?: string;
    example?: string;
    when_to_use?: string;
    why_works?: string;
  }>;
  user_facing_summary?: string;
}

/** 关联给 prompt 用的元信息（要包含博主名字，提示更可读） */
export interface FingerprintMeta {
  author_name: string;
  platform?: string | null;
  fingerprint: FingerprintShape;
}

/**
 * 把一份组合 + 对应的指纹 map 转成可以灌进 article / outline prompt 的
 * system 段落。不包含 emoji 禁令（那部分由 prompt 自己处理）。
 *
 * @param composition 用户选定的组合
 * @param fingerprints key = fingerprint_id, value = 该指纹的可读元信息
 */
export function buildCompositionSystemSnippet(
  composition: Composition,
  fingerprints: Map<string, FingerprintMeta>,
): string {
  const parts: string[] = [];

  if (!composition.selected_authors || composition.selected_authors.length === 0) {
    return '本次没有指定具体博主指纹。请使用克制、书卷气、中长篇深度文的通用写作风格。';
  }

  const sumWeight = composition.selected_authors.reduce(
    (s, a) => s + (Number.isFinite(a.weight) ? a.weight : 0),
    0,
  );
  const denom = sumWeight > 0 ? sumWeight : composition.selected_authors.length;

  parts.push('你将融合以下博主的写作指纹来完成本次写作：');
  parts.push('');

  composition.selected_authors.forEach((sel, idx) => {
    const meta = fingerprints.get(sel.fingerprint_id);
    if (!meta) return;
    const pct = Math.round((sel.weight / denom) * 100);
    const platform = meta.platform ? ` · ${meta.platform}` : '';
    parts.push(`【博主 ${idx + 1} · 占比 ${pct}%】${meta.author_name}${platform}`);

    if (meta.fingerprint.author_summary) {
      parts.push(`  · 一句话画像：${meta.fingerprint.author_summary}`);
    }
    if (meta.fingerprint.fingerprint_summary) {
      parts.push(`  · 三句话指纹：${meta.fingerprint.fingerprint_summary}`);
    }

    const strategies = sel.use_strategies && sel.use_strategies.length > 0
      ? new Set(sel.use_strategies)
      : null;

    const wantsAll = !strategies;
    if (wantsAll || strategies?.has('language')) {
      if (meta.fingerprint.language) {
        parts.push(`  · 语言：${stringifyShallow(meta.fingerprint.language)}`);
      }
    }
    if (wantsAll || strategies?.has('structure')) {
      if (meta.fingerprint.structure) {
        parts.push(`  · 结构：${stringifyShallow(meta.fingerprint.structure)}`);
      }
    }
    if (wantsAll || strategies?.has('topic')) {
      if (meta.fingerprint.topic) {
        parts.push(`  · 选题与论证：${stringifyShallow(meta.fingerprint.topic)}`);
      }
    }
    if (wantsAll || strategies?.has('visual')) {
      if (meta.fingerprint.visual) {
        parts.push(`  · 视觉偏好：${stringifyShallow(meta.fingerprint.visual)}`);
      }
    }
    if ((wantsAll || strategies?.has('do_list')) && Array.isArray(meta.fingerprint.do_list)) {
      parts.push(`  · 一定要：${(meta.fingerprint.do_list as unknown[]).join('；')}`);
    }
    if ((wantsAll || strategies?.has('dont_list')) && Array.isArray(meta.fingerprint.dont_list)) {
      parts.push(`  · 千万不要：${(meta.fingerprint.dont_list as unknown[]).join('；')}`);
    }
    parts.push('');
  });

  parts.push('融合规则：');
  parts.push('- 占比高的博主主导整体气质（开篇 / 论证骨架 / 收尾节奏）。');
  parts.push('- 占比低的博主作为佐料：在他擅长的维度上点缀（比如某个口头禅、某种过渡句式）。');
  parts.push('- 严禁机械拼贴：不要写"段落 A 用半佛风、段落 B 用刘润风"，要在每一句里融在一起。');
  parts.push('- 整体仍要像一个真人写的、连贯的、可发布的成稿。');

  if (composition.custom_notes && composition.custom_notes.trim()) {
    parts.push('');
    parts.push('用户对组合的额外说明（最高优先级）：');
    parts.push(composition.custom_notes.trim());
  }

  return parts.join('\n');
}

/**
 * 浅层 JSON -> 一行可读文本。
 * 用于把 fingerprint.language 这种嵌套对象压成一句话给 prompt。
 */
function stringifyShallow(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('；');
  }
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${typeof val === 'string' ? val : JSON.stringify(val)}`)
      .join('；');
  }
  return String(v);
}

/**
 * 从 SQLite 拉回来的行（lib/fingerprint-queries 用同样的 shape）
 * 转 FingerprintMeta map。
 */
export interface FingerprintRowLike {
  id: string;
  fingerprint_json: string;
  author_name: string;
  platform: string | null;
}

/**
 * v3 适配：给指纹生成「针对目标平台的额外提示段落」。
 *
 * 返回值会被 article/outline prompt 拼到 composition snippet 后面，提示模型：
 *   - 如果博主有 target 平台的 v3 platform_fingerprint，直接展开它
 *   - 否则给「跨平台改写策略」指导
 *   - 都没有就什么都不输出，调用方继续走 v2 通用路径
 *
 * 第二个参数是 v3 fingerprint 在中文里的 key（pickV3PlatformFingerprint 已经
 * 帮我们映射好了）。
 */
export function buildPlatformAwareSnippet(
  fingerprints: Map<string, FingerprintMeta>,
  composition: Composition,
  platformKeyCn: string | null,
): string {
  if (!fingerprints || fingerprints.size === 0) return '';
  const parts: string[] = [];

  for (const sel of composition.selected_authors) {
    const meta = fingerprints.get(sel.fingerprint_id);
    if (!meta) continue;
    const fp = meta.fingerprint;
    const platformFps = fp.platform_fingerprints;
    const xreport = fp.cross_platform_report;

    // 没有 v3 字段：跳过（走 v2 通用路径，调用方已经塞过 buildCompositionSystemSnippet）
    if (!platformFps && !xreport && !fp.strategy_fragments) continue;

    parts.push(`【${meta.author_name} · 目标平台适配】`);

    // 1) 命中专属平台指纹
    if (platformKeyCn && platformFps && typeof platformFps === 'object' && platformKeyCn in platformFps) {
      const pf = (platformFps as Record<string, unknown>)[platformKeyCn];
      if (pf && typeof pf === 'object') {
        parts.push(`  ▸ 命中博主在「${platformKeyCn}」的专属指纹，请直接套用：`);
        const pfo = pf as Record<string, unknown>;
        if (typeof pfo.fingerprint_summary === 'string') {
          parts.push(`    · 该平台三句话指纹：${pfo.fingerprint_summary}`);
        }
        if (pfo.language) parts.push(`    · 语言：${stringifyShallow(pfo.language)}`);
        if (pfo.structure) parts.push(`    · 结构：${stringifyShallow(pfo.structure)}`);
        if (pfo.topic) parts.push(`    · 选题：${stringifyShallow(pfo.topic)}`);
        if (Array.isArray(pfo.platform_specific_traits)) {
          parts.push(`    · 该平台专属动作：${(pfo.platform_specific_traits as unknown[]).join('；')}`);
        }
      }
    } else if (platformFps && typeof platformFps === 'object') {
      // 2) 有 v3 跨平台指纹但没命中该平台 → 给跨平台改写策略
      const have = Object.keys(platformFps);
      parts.push(`  ▸ 博主未在「${platformKeyCn || '该平台'}」留过样本，但有 ${have.join(' / ')} 的指纹。请按「跨平台改写策略」处理：保留观点骨架与论证密度，只调篇幅 / 节奏 / 钩子位置 / 小标题风格。`);
      if (xreport?.summary) {
        parts.push(`    · 跨平台总结：${xreport.summary}`);
      }
      if (Array.isArray(xreport?.transferable_patterns) && xreport.transferable_patterns.length > 0) {
        parts.push(`    · 可跨平台保留：${xreport.transferable_patterns.join('；')}`);
      }
    } else if (xreport?.summary || (Array.isArray(xreport?.transferable_patterns) && xreport.transferable_patterns.length > 0)) {
      // 3) 只有跨平台报告，没有 platform_fingerprints
      parts.push(`  ▸ 跨平台总结：${xreport?.summary ?? ''}`);
      if (Array.isArray(xreport?.transferable_patterns)) {
        parts.push(`    · 可跨平台保留：${xreport!.transferable_patterns.join('；')}`);
      }
    }

    // 4) 策略碎片按 platform_scope 过滤
    if (Array.isArray(fp.strategy_fragments) && fp.strategy_fragments.length > 0) {
      const filtered = fp.strategy_fragments.filter((f) => {
        if (!platformKeyCn) return true;
        if (!Array.isArray(f.platform_scope) || f.platform_scope.length === 0) return true;
        return f.platform_scope.includes(platformKeyCn);
      });
      const top = filtered.slice(0, 6);
      if (top.length > 0) {
        parts.push(`  ▸ 适用策略碎片（按目标平台过滤）：`);
        for (const f of top) {
          const tag = f.tag ? `[${f.tag}] ` : '';
          const title = f.title ?? '';
          const desc = f.description ?? '';
          parts.push(`    · ${tag}${title} — ${desc}`);
        }
      }
    }
    parts.push('');
  }

  return parts.join('\n').trim();
}

/**
 * 从 fingerprint 里抽取「这位博主针对目标平台的匹配质量」，给推荐 UI 用。
 *
 *   exact          — 博主在 v3 platform_fingerprints 里命中目标平台
 *   cross-platform — 博主有 v3 指纹但没该平台（按跨平台改写）
 *   generic        — 博主只有老版 v1/v2 指纹（通用化使用）
 */
export type PlatformMatchQuality = 'exact' | 'cross-platform' | 'generic';

export function judgePlatformMatchQuality(
  fp: FingerprintShape,
  platformKeyCn: string | null,
): PlatformMatchQuality {
  const platformFps = fp.platform_fingerprints;
  if (platformFps && typeof platformFps === 'object') {
    if (platformKeyCn && platformKeyCn in platformFps) return 'exact';
    return 'cross-platform';
  }
  // 跨平台报告 + 策略碎片，也算 v3，但没专属 → cross-platform
  if (fp.cross_platform_report || (Array.isArray(fp.strategy_fragments) && fp.strategy_fragments.length > 0)) {
    return 'cross-platform';
  }
  return 'generic';
}

export function buildFingerprintMetaMap(
  rows: FingerprintRowLike[],
): Map<string, FingerprintMeta> {
  const m = new Map<string, FingerprintMeta>();
  for (const r of rows) {
    let fp: FingerprintShape = {};
    try { fp = JSON.parse(r.fingerprint_json) as FingerprintShape; } catch {/* ignore */}
    m.set(r.id, {
      author_name: r.author_name,
      platform: r.platform,
      fingerprint: fp,
    });
  }
  return m;
}
