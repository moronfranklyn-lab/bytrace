'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ComposeNav } from '@/components/nav/ComposeNav';
import { Panel } from '@/components/compose/Panel';
import { Toast } from '@/components/compose/Toast';
import { PlatformPicker } from '@/components/compose/PlatformPicker';
import { CompositionExplainer } from '@/components/compose/CompositionExplainer';
import { PLATFORMS as PLATFORM_TRAITS, getPlatform, type PlatformKey } from '@/lib/platforms';
import { ARTICLE_CATEGORIES, type ArticleCategory } from '@/lib/prompts/fingerprint-v3-stage0';
import type { Outline, OutlineSection } from '@/lib/prompts/outline';

type LayoutKey = 'standard' | 'lively' | 'minimal';
type PanelKey = 'platform' | 'layout' | 'image' | 'export' | 'explainer';

interface LayoutOption {
  key: LayoutKey;
  name: string;
  hint: string;
}
const LAYOUTS: LayoutOption[] = [
  { key: 'standard', name: '正经版', hint: '公众号 · 知乎' },
  { key: 'lively', name: '活泼版', hint: '小红书' },
  { key: 'minimal', name: '极简版', hint: 'Medium · 博客' },
];

// ===== Types =====
interface RecommendCard {
  label?: string;
  selected_authors: Array<{
    author_id: string;
    fingerprint_id: string;
    weight: number;
    reason?: string;
  }>;
  composition_summary: string;
  why_match: string;
  platform_match_quality?: 'exact' | 'cross-platform' | 'generic';
}

interface SelectedAuthor {
  author_id: string;
  fingerprint_id: string;
  author_name: string;
  platform?: string | null;
  weight: number;
  enabled: boolean;
  reason?: string;
}

interface InspirationFragment {
  id: string;
  fingerprint_id: string;
  author_name: string | null;
  category: ArticleCategory | null;
  tag: string | null;
  title: string | null;
  description: string | null;
  example: string | null;
  when_to_use: string | null;
  why_works: string | null;
  platform_scope: string[];
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: '选目标平台' },
  { n: 2, label: '题材思路' },
  { n: 3, label: '推荐风格' },
  { n: 4, label: '微调组合' },
  { n: 5, label: '生成大纲' },
  { n: 6, label: '流式正文' },
  { n: 7, label: '预览导出' },
];

// ===== SSE 工具 =====
async function* readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!block.trim()) continue;
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const dataStr = dataLines.join('\n');
      let data: unknown = dataStr;
      try { data = JSON.parse(dataStr); } catch {/* keep string */}
      yield { event, data };
    }
    if (done) return;
  }
}

// ===== Lucide-equivalent SVG =====
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
function PlatformIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>;
}
function LayoutIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>;
}
function ImageIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
}
function ExportIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}
function CodeIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>; }
function FileIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>; }
function TextIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>; }

interface ExportButton { label: string; icon: () => ReactElement; mime: 'html' | 'md' | 'txt'; toast: string; }
const EXPORTS: ExportButton[] = [
  { label: '公众号 HTML', icon: CodeIcon, mime: 'html', toast: '已复制公众号 HTML 到剪贴板' },
  { label: 'Markdown', icon: FileIcon, mime: 'md', toast: '已复制 Markdown 到剪贴板' },
  { label: '小红书图片', icon: ImageIcon, mime: 'md', toast: '小红书图片导出（暂未接入 · mock）' },
  { label: '纯文本', icon: TextIcon, mime: 'txt', toast: '纯文本已复制到剪贴板' },
];

const IDEA_CHIPS = [
  '为什么越努力越穷？从剩余价值的现代变形入手，结合 996/KPI/内卷三个现象，落到议价权而非时间。',
  '想写一篇关于"为什么读书越多越焦虑"的随笔，从信息密度过载切入，最后回到读书是慢功夫。',
  'AI 时代普通人的护城河到底是什么？我想写一篇拒绝爽文、拒绝贩卖焦虑的冷静稿。',
];

// ===== Markdown 微渲染 =====
function renderMarkdown(md: string): string {
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
    if (inQuote) { out.push('</blockquote>'); inQuote = false; }
  };
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); closeQuote(); continue; }
    if (/^#\s+/.test(line))  { closeList(); closeQuote(); out.push(`<h1 class="article-title">${inline(line.replace(/^#\s+/, ''))}</h1>`); continue; }
    if (/^##\s+/.test(line)) { closeList(); closeQuote(); out.push(`<h2 class="article-h2">${inline(line.replace(/^##\s+/, ''))}</h2>`); continue; }
    if (/^>\s+/.test(line))  {
      closeList();
      if (!inQuote) { out.push('<blockquote class="article-quote">'); inQuote = true; }
      out.push(`<p>${inline(line.replace(/^>\s+/, ''))}</p>`);
      continue;
    }
    closeQuote();
    if (/^-\s+/.test(line))     {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(line.replace(/^-\s+/, ''))}</li>`); continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`); continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeQuote();
  return out.join('\n');
}

function countWords(s: string): number {
  // 中文按字符算；英文按词算的近似简化版
  return s.replace(/\s+/g, '').length;
}

function stripJsonFence(raw: string): string {
  const m = raw.match(/```json\s*([\s\S]*?)```/i);
  if (m) return m[1].trim();
  const fb = raw.search(/[\[{]/);
  const lb = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
  if (fb !== -1 && lb > fb) return raw.slice(fb, lb + 1).trim();
  return raw.trim();
}

// ===== 主组件 =====
export default function ComposePage() {
  const [step, setStep] = useState<Step>(1);

  // Step 1 · 目标平台 + 具体站点（可选；选了某个站点画像，prompt 会注入它的 profile）
  const [targetPlatform, setTargetPlatform] = useState<PlatformKey | null>(null);
  const [targetSiteId, setTargetSiteId] = useState<string | null>(null);

  // Step 2 · 题材
  const [idea, setIdea] = useState('');

  // Step 3 · 推荐
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendCard[]>([]);
  const [recommendStream, setRecommendStream] = useState('');
  const [pickedRec, setPickedRec] = useState<number | null>(null);
  const [emptyLibrary, setEmptyLibrary] = useState(false);

  // Step 4 — selected authors after tuning
  const [authors, setAuthors] = useState<SelectedAuthor[]>([]);
  const [customNotes, setCustomNotes] = useState('');
  /** 用户最终选定的推荐卡片（透传给 Step 7 explainer） */
  const [chosenRecommendation, setChosenRecommendation] = useState<RecommendCard | null>(null);

  // 灵感参考 · 跨博主碎片（类别可选，默认不选 = 全部，不污染 prompt）
  const [inspirationCategory, setInspirationCategory] = useState<ArticleCategory | null>(null);
  const [inspirationItems, setInspirationItems] = useState<InspirationFragment[]>([]);
  const [inspirationLoading, setInspirationLoading] = useState(false);
  const [inspirationOpen, setInspirationOpen] = useState(true);

  // 风格配方（选了配方 → 把碎片汇成文本注入 customNotes，让下游 prompt 接收到）
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  // Step 5 — outline
  const [outline, setOutline] = useState<Outline | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineStream, setOutlineStream] = useState('');
  const [outlineError, setOutlineError] = useState<string | null>(null);

  // Step 6 — draft
  const [draftMd, setDraftMd] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftDone, setDraftDone] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftCtrl = useRef<AbortController | null>(null);
  const draftScrollRef = useRef<HTMLDivElement | null>(null);

  // Step 7 · 预览导出
  const [layout, setLayout] = useState<LayoutKey>('standard');
  /** 预览当前所选平台（独立于 targetPlatform，便于切平台对比） */
  const [previewPlatform, setPreviewPlatform] = useState<PlatformKey>('wechat');
  const [panels, setPanels] = useState<Record<PanelKey, boolean>>({
    platform: true, layout: true, image: true, export: true, explainer: false,
  });
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineMap, setRefineMap] = useState<Partial<Record<PlatformKey, string>>>({});
  const [articleId, setArticleId] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToast({ visible: true, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2400);
  }, []);

  const ideaWordCount = useMemo(() => countWords(idea), [idea]);

  // 当 targetPlatform 改变时，把预览平台同步过去
  useEffect(() => {
    if (targetPlatform) setPreviewPlatform(targetPlatform);
  }, [targetPlatform]);

  // 灵感参考拉取：选了平台后即可拉；类别不选 = 不带 category（全部）
  useEffect(() => {
    // 只在 Step 4（微调组合）阶段拉，避免无谓请求
    if (step !== 4) return;
    if (!targetPlatform) return;
    const platformName = getPlatform(targetPlatform).name;
    const params = new URLSearchParams();
    if (inspirationCategory) params.set('category', inspirationCategory);
    params.set('platform', platformName);
    params.set('limit', '10');
    const ctrl = new AbortController();
    setInspirationLoading(true);
    fetch(`/api/strategies/search?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { items?: InspirationFragment[] }) => {
        setInspirationItems(Array.isArray(j?.items) ? j.items.slice(0, 6) : []);
        setInspirationLoading(false);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') {
          setInspirationItems([]);
          setInspirationLoading(false);
        }
      });
    return () => ctrl.abort();
  }, [step, targetPlatform, inspirationCategory]);

  // ----- Step 1 -> 2 -----
  const goFromPlatformToIdea = useCallback(() => {
    if (!targetPlatform) {
      showToast('先挑一个目标平台再走下一步');
      return;
    }
    setStep(2);
  }, [targetPlatform, showToast]);

  // ----- Step 2 -> 3 -----
  const goRecommend = useCallback(async () => {
    if (ideaWordCount < 30) {
      showToast(`再多写一点（当前 ${ideaWordCount} 字 · 至少 30 字）`);
      return;
    }
    setStep(3);
    setRecommendLoading(true);
    setRecommendError(null);
    setRecommendStream('');
    setRecommendations([]);
    setPickedRec(null);
    setEmptyLibrary(false);

    try {
      const resp = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, target_platform: targetPlatform ?? undefined }),
      });

      const ct = resp.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        // 指纹库为空 / 错误
        const j = await resp.json();
        if (j && j.empty) {
          setEmptyLibrary(true);
          setRecommendLoading(false);
          showToast('指纹库还没有博主，跳过推荐，使用通用风格');
          return;
        }
        if (j && j.error) {
          setRecommendError(j.error);
          setRecommendLoading(false);
          return;
        }
        setRecommendError('未知响应');
        setRecommendLoading(false);
        return;
      }

      if (!resp.body) { setRecommendError('响应没有 body'); setRecommendLoading(false); return; }
      const reader = resp.body.getReader();
      for await (const evt of readSseEvents(reader)) {
        if (evt.event === 'chunk') {
          const text = (evt.data as { text?: string })?.text ?? '';
          setRecommendStream((s) => s + text);
        } else if (evt.event === 'done') {
          const recs = (evt.data as { recommendations?: RecommendCard[] })?.recommendations ?? [];
          setRecommendations(recs);
          setRecommendLoading(false);
        } else if (evt.event === 'error') {
          const d = evt.data as { message?: string };
          setRecommendError(d.message || '模型那边出了点小问题');
          setRecommendLoading(false);
        }
      }
    } catch (e) {
      setRecommendError((e as Error).message);
      setRecommendLoading(false);
    }
  }, [idea, ideaWordCount, showToast, targetPlatform]);

  // ----- 选定推荐 → Step 4 -----
  const pickRecommendation = useCallback(async (i: number) => {
    setPickedRec(i);
    const rec = recommendations[i];
    if (!rec) return;
    setChosenRecommendation(rec);
    // 拉一下指纹名字 / 平台（一次性查所有），为 UI 显示
    const meta = await fetchFingerprintNames(rec.selected_authors.map((a) => a.fingerprint_id));
    setAuthors(
      rec.selected_authors.map((a) => ({
        author_id: a.author_id,
        fingerprint_id: a.fingerprint_id,
        author_name: meta[a.fingerprint_id]?.author_name ?? '（未知博主）',
        platform: meta[a.fingerprint_id]?.platform ?? null,
        weight: a.weight,
        enabled: true,
        reason: a.reason,
      })),
    );
    setStep(4);
  }, [recommendations]);

  // 跳过推荐（指纹库空 / 用户选择"我自己选"）
  const skipRecommendation = useCallback(() => {
    setChosenRecommendation(null);
    setStep(emptyLibrary ? 5 : 4);
    if (emptyLibrary) {
      setAuthors([]);
    }
  }, [emptyLibrary]);

  // Step 4 -> 5：生成大纲
  const goOutline = useCallback(async () => {
    setStep(5);
    setOutlineLoading(true);
    setOutlineError(null);
    setOutlineStream('');
    setOutline(null);

    const composition = {
      selected_authors: authors
        .filter((a) => a.enabled)
        .map((a) => ({
          author_id: a.author_id,
          fingerprint_id: a.fingerprint_id,
          weight: a.weight,
        })),
      custom_notes: customNotes || undefined,
    };

    try {
      const resp = await fetch('/api/compose/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea,
          composition,
          target_platform: targetPlatform ?? undefined,
          target_site_id: targetSiteId ?? undefined,
        }),
      });
      if (!resp.body) { setOutlineError('响应没有 body'); setOutlineLoading(false); return; }
      const reader = resp.body.getReader();
      for await (const evt of readSseEvents(reader)) {
        if (evt.event === 'chunk') {
          const text = (evt.data as { text?: string })?.text ?? '';
          setOutlineStream((s) => s + text);
        } else if (evt.event === 'done') {
          const ol = (evt.data as { outline?: Outline })?.outline;
          if (ol) setOutline(ol);
          setOutlineLoading(false);
        } else if (evt.event === 'error') {
          const d = evt.data as { message?: string };
          setOutlineError(d.message || '大纲生成出了点状况');
          setOutlineLoading(false);
        }
      }
    } catch (e) {
      setOutlineError((e as Error).message);
      setOutlineLoading(false);
    }
  }, [authors, customNotes, idea, targetPlatform]);

  // Step 5 -> 6：流式写正文
  const goDraft = useCallback(async () => {
    if (!outline) {
      showToast('大纲还没准备好');
      return;
    }
    setStep(6);
    setDraftMd('');
    setDraftLoading(true);
    setDraftDone(false);
    setDraftError(null);
    setArticleId(null);
    setRefineMap({});

    const composition = {
      selected_authors: authors
        .filter((a) => a.enabled)
        .map((a) => ({
          author_id: a.author_id,
          fingerprint_id: a.fingerprint_id,
          weight: a.weight,
        })),
      custom_notes: customNotes || undefined,
    };

    const ctrl = new AbortController();
    draftCtrl.current = ctrl;

    try {
      const resp = await fetch('/api/compose/draft', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea,
          composition,
          outline,
          target_platform: targetPlatform ?? undefined,
          target_site_id: targetSiteId ?? undefined,
        }),
      });
      if (!resp.body) { setDraftError('响应没有 body'); setDraftLoading(false); return; }
      const reader = resp.body.getReader();
      for await (const evt of readSseEvents(reader)) {
        if (evt.event === 'chunk') {
          const text = (evt.data as { text?: string })?.text ?? '';
          setDraftMd((s) => s + text);
          // 自动滚到底
          requestAnimationFrame(() => {
            const el = draftScrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
        } else if (evt.event === 'done') {
          const d = evt.data as { article_id?: string; content_md?: string };
          if (d.content_md) setDraftMd(d.content_md);
          if (d.article_id) setArticleId(d.article_id);
          setDraftLoading(false);
          setDraftDone(true);
        } else if (evt.event === 'error') {
          const d = evt.data as { message?: string; content_md?: string };
          if (d.content_md) setDraftMd(d.content_md);
          setDraftError(d.message || '正文生成出了点状况');
          setDraftLoading(false);
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setDraftError('已中止');
      } else {
        setDraftError((e as Error).message);
      }
      setDraftLoading(false);
    }
  }, [authors, customNotes, idea, outline, showToast, targetPlatform]);

  const stopDraft = useCallback(() => {
    draftCtrl.current?.abort();
  }, []);

  // Step 7：切平台 -> 调 refine
  const refineForPlatform = useCallback(async (p: PlatformKey) => {
    setPreviewPlatform(p);
    // 目标平台本身不需要改写（已是原文）
    if (p === (targetPlatform ?? 'wechat') || refineMap[p]) {
      showToast(`已切换到 ${PLATFORM_TRAITS.find((x) => x.key === p)?.name}`);
      return;
    }
    if (!draftMd) {
      showToast('还没有正文可改写');
      return;
    }
    setRefineLoading(true);
    let acc = '';
    try {
      const resp = await fetch('/api/compose/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_md: draftMd,
          platform: p,
          source_platform: targetPlatform ?? 'wechat',
          article_id: articleId,
        }),
      });
      if (!resp.body) { showToast('改写失败：没有响应'); setRefineLoading(false); return; }
      const reader = resp.body.getReader();
      for await (const evt of readSseEvents(reader)) {
        if (evt.event === 'chunk') {
          const t = (evt.data as { text?: string })?.text ?? '';
          acc += t;
          setRefineMap((m) => ({ ...m, [p]: acc }));
        } else if (evt.event === 'done') {
          const d = evt.data as { content_md?: string };
          if (d.content_md) {
            acc = d.content_md;
            setRefineMap((m) => ({ ...m, [p]: acc }));
          }
          setRefineLoading(false);
          showToast(`已按 ${PLATFORM_TRAITS.find((x) => x.key === p)?.name} 风格改写`);
        } else if (evt.event === 'error') {
          const d = evt.data as { message?: string };
          showToast(d.message || '改写出错了');
          setRefineLoading(false);
        }
      }
    } catch (e) {
      showToast((e as Error).message);
      setRefineLoading(false);
    }
  }, [draftMd, refineMap, showToast, targetPlatform, articleId]);

  // 当前预览用的 markdown
  const previewMd = useMemo(() => {
    if (previewPlatform === (targetPlatform ?? 'wechat')) return draftMd;
    return refineMap[previewPlatform] ?? draftMd;
  }, [previewPlatform, refineMap, draftMd, targetPlatform]);
  const previewHtml = useMemo(() => renderMarkdown(previewMd), [previewMd]);
  const previewWordCount = useMemo(() => countWords(previewMd), [previewMd]);

  // 导出
  const onExport = useCallback((kind: ExportButton) => {
    if (!previewMd) { showToast('还没有正文可导出'); return; }
    if (kind.mime === 'md') {
      navigator.clipboard?.writeText(previewMd).catch(() => {});
    } else if (kind.mime === 'html') {
      navigator.clipboard?.writeText(previewHtml).catch(() => {});
    } else if (kind.mime === 'txt') {
      const txt = previewMd.replace(/[#>*`-]/g, '').replace(/\n{2,}/g, '\n\n');
      navigator.clipboard?.writeText(txt).catch(() => {});
    }
    showToast(kind.toast);
  }, [previewMd, previewHtml, showToast]);

  // 推荐 stream 自动滚动（如果还在 streaming）
  const recommendScrollRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const el = recommendScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [recommendStream]);

  const outlineRawRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const el = outlineRawRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [outlineStream]);

  // 当前正在写的章节：根据 draftMd 里出现了几个 `## ` 判断
  const currentSectionIdx = useMemo(() => {
    if (!outline) return -1;
    const headings = (draftMd.match(/^##\s+/gm) ?? []).length;
    // 已经看到 N 个 ##，说明正在写第 N 个章节
    return Math.max(0, Math.min(headings - 1, outline.sections.length - 1));
  }, [draftMd, outline]);

  return (
    <>
      <ComposeNav currentLabel={stepLabel(step)} saveHint={articleId ? '已保存到本地' : undefined} />
      <main className="workbench">
        <Stepper current={step} onJump={(t) => {
          // 允许回退到已完成的步骤
          if (t < step) setStep(t);
        }} />

        {step === 1 && (
          <Step1Platform
            value={targetPlatform}
            siteId={targetSiteId}
            onChange={(k, sid) => {
              setTargetPlatform(k);
              setTargetSiteId(sid ?? null);
            }}
            onNext={goFromPlatformToIdea}
          />
        )}

        {step === 2 && (
          <Step2Idea
            idea={idea}
            onChange={setIdea}
            wordCount={ideaWordCount}
            onNext={goRecommend}
            onChip={(s) => setIdea(s)}
            onBack={() => setStep(1)}
            targetPlatform={targetPlatform}
          />
        )}

        {step === 3 && (
          <Step3Recommend
            loading={recommendLoading}
            error={recommendError}
            recommendations={recommendations}
            stream={recommendStream}
            streamRef={recommendScrollRef}
            picked={pickedRec}
            onPick={pickRecommendation}
            onSkip={skipRecommendation}
            onBack={() => setStep(2)}
            onRetry={goRecommend}
            emptyLibrary={emptyLibrary}
            targetPlatform={targetPlatform}
          />
        )}

        {step === 4 && (
          <RecipePickerPanel
            platformKey={targetPlatform}
            selectedRecipeId={selectedRecipeId}
            onSelect={(recipeId, recipeNotes) => {
              setSelectedRecipeId(recipeId);
              if (recipeNotes !== null) {
                setCustomNotes((prev) => {
                  // 把配方块追加到现有备注里，用分隔线区分
                  const stripped = prev.replace(/\n*---\n# 风格配方 ·[\s\S]*$/, '').trim();
                  return stripped ? `${stripped}\n\n---\n${recipeNotes}` : recipeNotes;
                });
              } else {
                // 取消选择：清掉之前注入的块
                setCustomNotes((prev) =>
                  prev.replace(/\n*---\n# 风格配方 ·[\s\S]*$/, '').trim(),
                );
              }
            }}
          />
        )}

        {step === 4 && (
          <Step4Tune
            authors={authors}
            setAuthors={setAuthors}
            customNotes={customNotes}
            setCustomNotes={setCustomNotes}
            onBack={() => setStep(3)}
            onNext={goOutline}
          />
        )}

        {step === 4 && (
          <InspirationPanel
            category={inspirationCategory}
            onCategoryChange={setInspirationCategory}
            platform={targetPlatform}
            items={inspirationItems}
            loading={inspirationLoading}
            open={inspirationOpen}
            onToggle={() => setInspirationOpen((v) => !v)}
          />
        )}

        {step === 5 && (
          <Step5Outline
            loading={outlineLoading}
            outline={outline}
            setOutline={setOutline}
            stream={outlineStream}
            streamRef={outlineRawRef}
            error={outlineError}
            onBack={() => setStep(4)}
            onRetry={goOutline}
            onNext={goDraft}
          />
        )}

        {step === 6 && (
          <Step6Draft
            outline={outline}
            draftMd={draftMd}
            loading={draftLoading}
            done={draftDone}
            error={draftError}
            currentSectionIdx={currentSectionIdx}
            scrollRef={draftScrollRef}
            onStop={stopDraft}
            onRetry={goDraft}
            onBack={() => setStep(5)}
            onNext={() => setStep(7)}
          />
        )}

        {step === 7 && (
          <Step7Preview
            previewMd={previewMd}
            previewHtml={previewHtml}
            previewWordCount={previewWordCount}
            layout={layout}
            setLayout={setLayout}
            platform={previewPlatform}
            targetPlatform={targetPlatform}
            onPlatform={refineForPlatform}
            refineLoading={refineLoading}
            panels={panels}
            togglePanel={(k) => setPanels((p) => ({ ...p, [k]: !p[k] }))}
            onExport={onExport}
            onBack={() => setStep(6)}
            showToast={showToast}
            articleId={articleId}
            chosenRecommendation={chosenRecommendation}
            draftMd={draftMd}
          />
        )}
      </main>
      <Toast visible={toast.visible} message={toast.message} />
    </>
  );
}

function stepLabel(step: Step): string {
  return STEPS.find((s) => s.n === step)?.label ?? '写新文章';
}

// ================== Sub Components ==================

function Stepper({ current, onJump }: { current: Step; onJump: (s: Step) => void }) {
  return (
    <div className="workbench-stepper">
      {STEPS.map((s, i) => (
        <span key={s.n} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className={
              'workbench-step ' +
              (s.n === current ? 'active' : s.n < current ? 'completed clickable' : '')
            }
            onClick={() => s.n < current && onJump(s.n)}
            disabled={s.n > current}
          >
            <span className="workbench-step-num">{s.n}</span>
            {s.label}
          </button>
          {i < STEPS.length - 1 && <span className="workbench-step-divider" />}
        </span>
      ))}
    </div>
  );
}

// ---------- Step 1 · 选目标平台（实例化为「站点画像 卡片 + 通用画像 卡片」混排）----------
interface SitePickerItem {
  kind: 'site' | 'generic';
  platform_key: PlatformKey;
  site_id?: string;
  site_name?: string;
  section?: string | null;
  sample_count?: number;
  title?: string;
  word_range_min: number | null;
  word_range_max: number | null;
  tone_hint?: string | null;
  tone_tag?: string;
  pacing?: string;
  ui_hint?: string;
  preferred_topics?: string[];
}

function Step1Platform({
  value, siteId, onChange, onNext,
}: {
  value: PlatformKey | null;
  siteId: string | null;
  onChange: (k: PlatformKey, sid?: string | null) => void;
  onNext: () => void;
}) {
  const [items, setItems] = useState<SitePickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sites/picker')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { items: SitePickerItem[] }) => {
        setItems(d.items ?? []);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const picked = value ? getPlatform(value) : null;
  const pickedItem = items.find((it) =>
    siteId ? it.kind === 'site' && it.site_id === siteId : it.kind === 'generic' && it.platform_key === value,
  );

  return (
    <section className="step-card">
      <p className="step-card-eyebrow">STEP 01 · TARGET PLATFORM</p>
      <h1 className="step-card-title">这篇要发到哪儿？</h1>
      <p className="step-card-sub">
        每张「站点画像」卡都是你拆过的具体板块——选了它，写大纲和正文就会按这个板块的篇幅、调性、开篇套路来调。没拆过的平台用通用画像兜底。
        <a
          href="/sites/new"
          style={{ marginLeft: 8, color: 'var(--accent)', textDecoration: 'underline' }}
        >
          + 去拆一个新板块
        </a>
      </p>

      {loading && <div style={{ opacity: 0.6, padding: 16 }}>加载站点画像…</div>}
      {error && (
        <div style={{ color: 'var(--danger, #c0392b)' }}>拉取失败：{error}</div>
      )}

      {!loading && items.length > 0 && (
        <div className="platform-picker-grid">
          {items.map((it) => {
            const active = it.kind === 'site'
              ? it.site_id === siteId
              : it.platform_key === value && !siteId;
            return (
              <button
                key={it.kind === 'site' ? `site-${it.site_id}` : `generic-${it.platform_key}`}
                type="button"
                className={'platform-picker-card' + (active ? ' active' : '')}
                onClick={() => onChange(it.platform_key, it.site_id ?? null)}
                onDoubleClick={() => {
                  onChange(it.platform_key, it.site_id ?? null);
                  onNext();
                }}
              >
                <div className="platform-picker-card-head">
                  <span className="platform-picker-name">
                    {it.kind === 'site' ? it.site_name : it.title}
                  </span>
                  <span className="platform-picker-tag">
                    {it.kind === 'site' ? `${it.sample_count} 篇样本` : it.tone_tag}
                  </span>
                </div>
                {it.kind === 'site' && it.section && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginBottom: 6,
                    }}
                  >
                    {it.section}
                  </div>
                )}
                {it.word_range_min && it.word_range_max && (
                  <div className="platform-picker-range">
                    {it.word_range_min.toLocaleString()}–{it.word_range_max.toLocaleString()} 字
                  </div>
                )}
                {it.kind === 'site' ? (
                  <>
                    {it.tone_hint && (
                      <div className="platform-picker-pacing">{it.tone_hint}…</div>
                    )}
                    {it.preferred_topics && it.preferred_topics.length > 0 && (
                      <div
                        className="platform-picker-hint"
                        style={{ fontSize: 11, opacity: 0.7 }}
                      >
                        常写：{it.preferred_topics.slice(0, 2).join(' / ')}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="platform-picker-pacing">{it.pacing}</div>
                    <div className="platform-picker-hint">{it.ui_hint}</div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {pickedItem && (
        <div style={{
          background: 'var(--surface-light)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '12px 16px',
          fontSize: 12,
          color: 'var(--text-secondary)',
          lineHeight: 1.7,
          marginTop: 12,
        }}>
          <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 500 }}>
            已选「{pickedItem.kind === 'site' ? pickedItem.site_name : pickedItem.title}」
            {pickedItem.kind === 'site' && pickedItem.section ? ` · ${pickedItem.section}` : ''}
          </strong>
          {picked && (
            <>
              ：基础平台「{picked.name}」 · 建议 {pickedItem.word_range_min?.toLocaleString()}–{pickedItem.word_range_max?.toLocaleString()} 字 · {picked.voice}
            </>
          )}
        </div>
      )}

      <div className="step-actions">
        <div className="step-actions-left" />
        <div className="step-actions-right">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onNext}
            disabled={!value}
          >
            写题材思路 <span className="btn-arrow">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Step 2 · 题材 ----------
function Step2Idea({
  idea, onChange, wordCount, onNext, onChip, onBack, targetPlatform,
}: {
  idea: string;
  onChange: (s: string) => void;
  wordCount: number;
  onNext: () => void;
  onChip: (s: string) => void;
  onBack: () => void;
  targetPlatform: PlatformKey | null;
}) {
  const picked = targetPlatform ? getPlatform(targetPlatform) : null;
  return (
    <section className="step-card">
      <p className="step-card-eyebrow">STEP 02 · IDEA</p>
      <h1 className="step-card-title">今天想写点什么？</h1>
      <p className="step-card-sub">
        {picked
          ? `目标平台是「${picked.name}」（${picked.word_range_min.toLocaleString()}–${picked.word_range_max.toLocaleString()} 字）。把题材、角度、核心观点丢进来，越具体越好。`
          : '把题材、你想说的角度、想表达的核心观点都丢进来，越具体越好。'}
      </p>
      <textarea
        className="workbench-textarea"
        placeholder="例如：想写一篇关于…&#10;我的角度是…&#10;核心观点：…"
        value={idea}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="idea-meta">
        <span>当前 {wordCount} 字 · 至少 30 字才能进入下一步</span>
        <span>{wordCount >= 30 ? '可以下一步' : `还差 ${30 - wordCount} 字`}</span>
      </div>
      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em', margin: '0 0 8px' }}>
          没想好？挑一条试试
        </p>
        <div className="idea-chips">
          {IDEA_CHIPS.map((c, i) => (
            <button key={i} type="button" className="idea-chip" onClick={() => onChip(c)}>
              {c.slice(0, 22)}…
            </button>
          ))}
        </div>
      </div>
      <div className="step-actions">
        <div className="step-actions-left">
          <button type="button" className="btn btn-ghost" onClick={onBack}>← 改目标平台</button>
        </div>
        <div className="step-actions-right">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onNext}
            disabled={wordCount < 30}
          >
            推荐风格 <span className="btn-arrow">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Step 3 · 推荐风格 ----------
function Step3Recommend({
  loading, error, recommendations, stream, streamRef, picked, onPick, onSkip, onBack, onRetry, emptyLibrary, targetPlatform,
}: {
  loading: boolean;
  error: string | null;
  recommendations: RecommendCard[];
  stream: string;
  streamRef: React.RefObject<HTMLPreElement | null>;
  picked: number | null;
  onPick: (i: number) => void;
  onSkip: () => void;
  onBack: () => void;
  onRetry: () => void;
  emptyLibrary: boolean;
  targetPlatform: PlatformKey | null;
}) {
  const platformName = targetPlatform ? getPlatform(targetPlatform).name : null;
  return (
    <section className="step-card">
      <p className="step-card-eyebrow">STEP 03 · STYLE RECOMMENDATIONS</p>
      <h1 className="step-card-title">为你挑了几套写作风格</h1>
      <p className="step-card-sub">
        {platformName
          ? `这是基于你的题材 + 目标平台「${platformName}」+ 指纹库里所有博主推荐的组合。匹配档位徽章会标出每位博主在目标平台的契合度。`
          : '这是基于你这次题材 + 指纹库里所有博主推荐的组合。单个博主、多个博主融合都有。直接选一个，或者跳过让自己挑。'}
      </p>

      {emptyLibrary && (
        <Banner kind="info" title="指纹库还是空的">
          先去拆几位博主再回来就能用了。这次先用通用风格继续。
        </Banner>
      )}

      {loading && (
        <>
          <Banner kind="loading" title="模型正在挑选…">
            正在通读所有指纹，给你筛 3 套互不相同的风格。第一次推荐通常需要 30-60 秒。
          </Banner>
          <pre ref={streamRef} className="outline-stream-raw">{stream || '...'}</pre>
        </>
      )}

      {!loading && error && (
        <Banner kind="error" title="模型这次没接住">
          {error}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              <RetryIcon /> 再试一次
            </button>
          </div>
        </Banner>
      )}

      {!loading && !error && recommendations.length > 0 && (
        <div className="recommend-grid">
          {recommendations.map((r, i) => (
            <div
              key={i}
              className={'recommend-card' + (picked === i ? ' selected' : '')}
              onClick={() => onPick(i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i); } }}
            >
              <div className="recommend-card-head">
                <h3 className="recommend-card-title">{r.label || `推荐组合 ${i + 1}`}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {r.platform_match_quality && targetPlatform && (
                    <MatchBadge q={r.platform_match_quality} />
                  )}
                  <span className="recommend-card-count">{r.selected_authors.length} 位博主</span>
                </div>
              </div>
              <div className="recommend-authors">
                {r.selected_authors.map((a, j) => (
                  <span key={j} className="recommend-author-chip">
                    <strong>{a.fingerprint_id.slice(0, 6)}</strong> · {Math.round(a.weight * 100)}%
                  </span>
                ))}
              </div>
              <p className="recommend-summary">{r.composition_summary}</p>
              <p className="recommend-why">{r.why_match}</p>
            </div>
          ))}
        </div>
      )}

      <div className="step-actions">
        <div className="step-actions-left">
          <button type="button" className="btn btn-ghost" onClick={onBack}>← 返回</button>
        </div>
        <div className="step-actions-right">
          <button type="button" className="btn btn-secondary" onClick={onSkip}>
            {emptyLibrary ? '使用通用风格继续' : '我自己挑'} <span className="btn-arrow">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Step 4 · 微调组合 ----------
function Step4Tune({
  authors, setAuthors, customNotes, setCustomNotes, onBack, onNext,
}: {
  authors: SelectedAuthor[];
  setAuthors: React.Dispatch<React.SetStateAction<SelectedAuthor[]>>;
  customNotes: string;
  setCustomNotes: (s: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const activeCount = authors.filter((a) => a.enabled).length;
  return (
    <section className="step-card">
      <p className="step-card-eyebrow">STEP 04 · TUNE COMPOSITION</p>
      <h1 className="step-card-title">微调风格组合</h1>
      <p className="step-card-sub">
        每位博主的占比都可以拖。你也可以勾掉不想要的，留一个核心博主就够。
        {activeCount === 0 && '（至少保留一位）'}
      </p>

      {authors.length === 0 && (
        <Banner kind="info" title="没有具体博主">
          这次会用通用写作风格生成。你也可以返回上一步选一个推荐组合。
        </Banner>
      )}

      {authors.length > 0 && (
        <div className="tune-grid">
          {authors.map((a, i) => (
            <div key={a.fingerprint_id} className={'tune-row' + (a.enabled ? '' : ' disabled')}>
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={(e) => setAuthors((arr) => arr.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                aria-label="启用此博主"
              />
              <div>
                <div className="tune-row-name">{a.author_name}</div>
                <div className="tune-row-platform">{a.platform || '未标平台'} · {a.reason ?? ''}</div>
              </div>
              <input
                type="range" min={0} max={100}
                value={Math.round(a.weight * 100)}
                onChange={(e) => setAuthors((arr) => arr.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) / 100 } : x)))}
                disabled={!a.enabled}
              />
              <span className="tune-row-weight">{Math.round(a.weight * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="outline-meta-field" style={{ marginTop: 8 }}>
        <label>额外调整说明（可选）</label>
        <textarea
          value={customNotes}
          onChange={(e) => setCustomNotes(e.target.value)}
          placeholder="例如：希望开篇更冷一点 / 不要金句堆砌 / 收尾保留留白"
        />
      </div>

      <div className="step-actions">
        <div className="step-actions-left">
          <button type="button" className="btn btn-ghost" onClick={onBack}>← 返回推荐</button>
        </div>
        <div className="step-actions-right">
          <button type="button" className="btn btn-primary" onClick={onNext}>
            生成大纲 <span className="btn-arrow">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Step 5 · 生成大纲 ----------
const STRUCTURE_SHAPE_LABEL: Record<NonNullable<Outline['structure_shape']>, string> = {
  causal_chain: '因果链',
  dual_contrast: '双线对比',
  concentric: '同心圆',
  flat_list: '平铺列举',
  timeline: '时间轴',
  problem_solution: '问题→方案',
};

const DEPTH_ROLE_LABEL: Record<NonNullable<OutlineSection['depth_role']>, string> = {
  open: '开篇',
  deeper: '挖深一层',
  parallel: '并列补充',
  turn: '反转',
  close: '收尾',
};

function Step5Outline({
  loading, outline, setOutline, stream, streamRef, error, onBack, onRetry, onNext,
}: {
  loading: boolean;
  outline: Outline | null;
  setOutline: (o: Outline) => void;
  stream: string;
  streamRef: React.RefObject<HTMLPreElement | null>;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  onNext: () => void;
}) {
  return (
    <section className="step-card">
      <p className="step-card-eyebrow">STEP 05 · OUTLINE</p>
      <h1 className="step-card-title">先把骨架搭起来</h1>
      <p className="step-card-sub">
        正文还没开写，先确认大纲。每个章节都可以改字、调字数、删要点。骨架定了，肉就好填。
      </p>

      {loading && (
        <>
          <Banner kind="loading" title="模型正在写大纲…">
            通常 20-45 秒能出来。下面是原始流式输出，方便你早点感知模型的思路方向。
          </Banner>
          <pre ref={streamRef} className="outline-stream-raw">{stream || '...'}</pre>
        </>
      )}

      {!loading && error && (
        <Banner kind="error" title="大纲生成卡住了">
          {error}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              <RetryIcon /> 再试一次
            </button>
          </div>
        </Banner>
      )}

      {!loading && outline && (
        <div className="outline-editor">
          {(outline.structure_shape || outline.core_thesis) && (
            <div style={{ marginBottom: 12 }}>
              {outline.structure_shape && (
                <span className="tag" style={{ marginRight: 8 }}>
                  {STRUCTURE_SHAPE_LABEL[outline.structure_shape]}
                </span>
              )}
              {outline.core_thesis && (
                <blockquote style={{
                  margin: '8px 0 0',
                  padding: '6px 12px',
                  borderLeft: '3px solid var(--accent, #999)',
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                }}>
                  {outline.core_thesis}
                </blockquote>
              )}
            </div>
          )}
          <div className="outline-meta">
            <div className="outline-meta-field">
              <label>工作标题</label>
              <input
                value={outline.working_title}
                onChange={(e) => setOutline({ ...outline, working_title: e.target.value })}
              />
            </div>
            <div className="outline-meta-field">
              <label>预计总字数</label>
              <input
                type="number"
                value={outline.total_words_estimate}
                onChange={(e) => setOutline({ ...outline, total_words_estimate: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div className="outline-meta">
            <div className="outline-meta-field">
              <label>开篇思路</label>
              <textarea
                value={outline.hook_idea}
                onChange={(e) => setOutline({ ...outline, hook_idea: e.target.value })}
              />
            </div>
            <div className="outline-meta-field">
              <label>收尾思路</label>
              <textarea
                value={outline.closing_idea}
                onChange={(e) => setOutline({ ...outline, closing_idea: e.target.value })}
              />
            </div>
          </div>

          <p style={{ margin: '8px 0 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
            章节（{outline.sections.length}）
          </p>
          {outline.sections.map((s, i) => (
            <div key={i} className="outline-section-card">
              <div className="outline-section-head">
                <span className="outline-section-num">{i + 1}</span>
                <input
                  className="outline-section-title"
                  value={s.title}
                  onChange={(e) => {
                    const next = { ...outline };
                    next.sections = [...next.sections];
                    next.sections[i] = { ...next.sections[i], title: e.target.value };
                    setOutline(next);
                  }}
                />
                {s.depth_role && (
                  <span className="tag" style={{ marginLeft: 6, fontSize: 11 }}>
                    {DEPTH_ROLE_LABEL[s.depth_role]}
                  </span>
                )}
                <input
                  className="outline-section-budget"
                  type="number"
                  value={s.word_budget}
                  onChange={(e) => {
                    const next = { ...outline };
                    next.sections = [...next.sections];
                    next.sections[i] = { ...next.sections[i], word_budget: Number(e.target.value) || 0 };
                    setOutline(next);
                  }}
                />
              </div>
              {s.thesis && (
                <p style={{
                  margin: '4px 0 6px 32px',
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: 'var(--text-muted)',
                }}>
                  {s.thesis}
                </p>
              )}
              <ul className="outline-bullet-list">
                {s.bullets.map((b, j) => (
                  <li key={j} className="outline-bullet">{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="step-actions">
        <div className="step-actions-left">
          <button type="button" className="btn btn-ghost" onClick={onBack}>← 返回</button>
          {!loading && outline && (
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              <RetryIcon /> 重新生成大纲
            </button>
          )}
        </div>
        <div className="step-actions-right">
          <button type="button" className="btn btn-primary" onClick={onNext} disabled={!outline || loading}>
            开始写正文 <span className="btn-arrow">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Step 6 · 流式正文 ----------
function Step6Draft({
  outline, draftMd, loading, done, error, currentSectionIdx, scrollRef,
  onStop, onRetry, onBack, onNext,
}: {
  outline: Outline | null;
  draftMd: string;
  loading: boolean;
  done: boolean;
  error: string | null;
  currentSectionIdx: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onStop: () => void;
  onRetry: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  // 触发首次 generation
  useEffect(() => {
    if (!loading && !done && !error && !draftMd) {
      onRetry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="step-card">
      <p className="step-card-eyebrow">STEP 06 · STREAM DRAFT</p>
      <h1 className="step-card-title">正在按大纲写正文</h1>
      <p className="step-card-sub">
        左侧高亮当前正在写的章节，右侧是实时输出。可以随时中止 / 重新生成。
      </p>

      <div className="draft-stream-controls">
        <span className={'draft-status-dot ' + (loading ? '' : done ? 'done' : 'idle')} />
        <span className="draft-status-text">
          {loading ? `正在写…  已 ${countWords(draftMd)} 字` : done ? `写完了 · 共 ${countWords(draftMd)} 字` : '空闲'}
        </span>
        <div style={{ flex: 1 }} />
        {loading && (
          <button type="button" className="btn btn-ghost" onClick={onStop}>
            中止
          </button>
        )}
        {!loading && (
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            <RetryIcon /> 重新生成
          </button>
        )}
      </div>

      {error && !loading && (
        <Banner kind="error" title="生成中断">
          {error}
        </Banner>
      )}

      <div className="draft-layout">
        <aside className="draft-outline">
          <div className="draft-outline-head">大纲 · {outline?.sections.length ?? 0} 节</div>
          {outline?.sections.map((s, i) => (
            <div
              key={i}
              className={
                'draft-outline-item ' +
                (i === currentSectionIdx && loading ? 'active' : i < currentSectionIdx ? 'done' : '')
              }
            >
              {i + 1}. {s.title}
            </div>
          ))}
        </aside>
        <div className="draft-stream" ref={scrollRef}>
          {draftMd ? (
            <article
              className="article draft-stream-md"
              dangerouslySetInnerHTML={{
                __html:
                  renderMarkdown(draftMd) +
                  (loading ? '<span class="cursor-blink"></span>' : ''),
              }}
            />
          ) : (
            <pre className="draft-stream-pre" style={{ color: 'var(--text-muted)' }}>
              {loading ? '正在等待第一段…' : '点上面的"重新生成"开始'}
            </pre>
          )}
        </div>
      </div>

      <div className="step-actions">
        <div className="step-actions-left">
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={loading}>← 返回大纲</button>
        </div>
        <div className="step-actions-right">
          <button type="button" className="btn btn-primary" onClick={onNext} disabled={!draftMd || loading}>
            预览与导出 <span className="btn-arrow">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Step 7 · 预览导出 ----------
function Step7Preview({
  previewMd, previewHtml, previewWordCount, layout, setLayout, platform, targetPlatform,
  onPlatform, refineLoading,
  panels, togglePanel, onExport, onBack, showToast,
  articleId, chosenRecommendation, draftMd,
}: {
  previewMd: string;
  previewHtml: string;
  previewWordCount: number;
  layout: LayoutKey;
  setLayout: (l: LayoutKey) => void;
  platform: PlatformKey;
  targetPlatform: PlatformKey | null;
  onPlatform: (p: PlatformKey) => void;
  refineLoading: boolean;
  panels: Record<PanelKey, boolean>;
  togglePanel: (k: PanelKey) => void;
  onExport: (b: ExportButton) => void;
  onBack: () => void;
  showToast: (m: string) => void;
  articleId: string | null;
  chosenRecommendation: RecommendCard | null;
  draftMd: string;
}) {
  return (
    <section className="compose-layout" style={{ padding: 0, maxWidth: '100%' }}>
      <section className="preview-card">
        <div className="preview-head">
          <div className="preview-head-left">
            <span className="preview-eyebrow">PREVIEW</span>
            <div className="preview-meta">
              <span className="tag">{PLATFORM_TRAITS.find((p) => p.key === platform)?.name}</span>
              <span className="tag">{LAYOUTS.find((l) => l.key === layout)?.name}</span>
              <span className="tag">{previewWordCount} 字</span>
              {refineLoading && <span className="tag" style={{ color: 'var(--accent)' }}>改写中…</span>}
            </div>
          </div>
          <div className="preview-toolbar">
            <button type="button" className="icon-btn" title="返回正文流" onClick={onBack}>
              <RetryIcon />
            </button>
            <button type="button" className="icon-btn" title="复制 Markdown" onClick={() => {
              navigator.clipboard?.writeText(previewMd).catch(() => {});
              showToast('已复制 Markdown');
            }}>
              <CopyIcon />
            </button>
          </div>
        </div>
        <div className="preview-body">
          <article className="article" data-layout={layout} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </section>

      <aside className="drawer">
        <Panel title="一键切换平台" icon={<PlatformIcon />} open={panels.platform} onToggle={() => togglePanel('platform')}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 10px' }}>
            切换后会按目标平台风格改写。第一次切换有 20-40 秒等待。
          </p>
          <div className="platform-list">
            {PLATFORM_TRAITS.map((p) => {
              const active = platform === p.key;
              const isOriginal = (targetPlatform ?? 'wechat') === p.key;
              return (
                <div
                  key={p.key}
                  className={'platform-row' + (active ? ' active' : '')}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPlatform(p.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlatform(p.key); } }}
                >
                  <div>
                    <div className="platform-name">
                      {p.name}
                      {isOriginal && <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>原文</span>}
                    </div>
                    <div className="platform-info">{p.ui_hint}</div>
                  </div>
                  <span className="switch-mark">{active ? '●' : '↻'}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="调整排版" icon={<LayoutIcon />} open={panels.layout} onToggle={() => togglePanel('layout')}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 10px' }}>
            预览区实时变样式。导出时按所选主题输出 HTML/MD。
          </p>
          <div className="layout-grid">
            {LAYOUTS.map((l) => (
              <button
                key={l.key}
                type="button"
                className={'layout-card' + (layout === l.key ? ' active' : '')}
                onClick={() => setLayout(l.key)}
              >
                <div className="layout-preview">
                  {l.key === 'standard' && <><div className="lp-bar title"/><div className="lp-bar accent" style={{ height: 3, width: '30%' }}/><div className="lp-bar"/><div className="lp-bar short"/></>}
                  {l.key === 'lively' && <><div className="lp-bar accent" style={{ height: 6, width: '80%', margin: '0 auto' }}/><div className="lp-bar"/><div className="lp-bar short"/><div className="lp-bar accent" style={{ opacity: 0.5 }}/></>}
                  {l.key === 'minimal' && <><div className="lp-bar title" style={{ opacity: 0.5 }}/><div className="lp-bar"/><div className="lp-bar"/><div className="lp-bar short"/></>}
                </div>
                <div className="layout-name">{l.name}</div>
                <div className="layout-platform-hint">{l.hint}</div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="自动配图" icon={<ImageIcon />} open={panels.image} onToggle={() => togglePanel('image')}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
            配图能力由独立模块负责，会在文章保存后异步给出候选。这里暂不展开。
          </p>
        </Panel>

        <Panel title="一键导出" icon={<ExportIcon />} open={panels.export} onToggle={() => togglePanel('export')}>
          <div className="export-grid">
            {EXPORTS.map((e) => {
              const Icon = e.icon;
              return (
                <button key={e.label} type="button" className="export-btn" onClick={() => onExport(e)}>
                  <Icon />
                  {e.label}
                </button>
              );
            })}
          </div>
          <div className="export-cta">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => showToast('已发往公众号草稿箱（mock）')}
            >
              一键发往公众号草稿箱 <span className="btn-arrow">→</span>
            </button>
          </div>
        </Panel>

        <Panel title="拆解此文产出逻辑" icon={<ExplainerIcon />} open={panels.explainer} onToggle={() => togglePanel('explainer')}>
          <CompositionExplainer
            articleId={articleId}
            compositionSummary={chosenRecommendation?.composition_summary}
            whyMatch={chosenRecommendation?.why_match}
            targetPlatform={targetPlatform}
            contentMd={draftMd}
          />
        </Panel>
      </aside>
    </section>
  );
}

function ExplainerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function MatchBadge({ q }: { q: 'exact' | 'cross-platform' | 'generic' }) {
  const label = q === 'exact' ? '专属指纹' : q === 'cross-platform' ? '跨平台改写' : '通用';
  const cls = q === 'exact' ? 'match-exact' : q === 'cross-platform' ? 'match-cross' : 'match-generic';
  return <span className={`match-badge ${cls}`}>{label}</span>;
}

// ---------- 灵感参考 · 跨博主碎片（轻量内联，不入 prompt） ----------
function InspirationPanel({
  category, onCategoryChange, platform, items, loading, open, onToggle,
}: {
  category: ArticleCategory | null;
  onCategoryChange: (c: ArticleCategory | null) => void;
  platform: PlatformKey | null;
  items: InspirationFragment[];
  loading: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const platformName = platform ? getPlatform(platform).name : null;
  return (
    <section
      className="step-card"
      style={{ background: 'var(--surface)', padding: '20px 24px', gap: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p className="step-card-eyebrow" style={{ marginBottom: 4 }}>INSPIRATION · 灵感参考</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500, color: 'var(--text)', margin: 0 }}>
            我要写哪一类？{platformName && (
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
                {platformName} · 只看参考、不进 prompt
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onToggle}
          style={{ fontSize: 12 }}
        >
          {open ? '收起' : '展开'}
        </button>
      </div>

      {open && (
        <>
          <div className="idea-chips" style={{ gap: 8 }}>
            <button
              type="button"
              className="idea-chip"
              onClick={() => onCategoryChange(null)}
              style={category === null ? {
                background: 'var(--surface-white)',
                color: 'var(--text)',
                borderColor: 'var(--border-medium)',
              } : undefined}
            >
              全部 · 跳过
            </button>
            {ARTICLE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className="idea-chip"
                onClick={() => onCategoryChange(c)}
                style={category === c ? {
                  background: 'var(--surface-white)',
                  color: 'var(--text)',
                  borderColor: 'var(--border-medium)',
                } : undefined}
              >
                {c}
              </button>
            ))}
          </div>

          {loading && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              正在召回跨博主碎片…
            </p>
          )}

          {!loading && items.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              这一类在指纹库里还没有可参考的碎片。{category ? '试试切到「全部」。' : '先去拆几位博主吧。'}
            </p>
          )}

          {!loading && items.length > 0 && (
            <div className="strategies-grid">
              {items.map((it) => (
                <div key={it.id} className="strategy-card">
                  <div className="strategy-card-head">
                    {it.author_name && <span className="tag">{it.author_name}</span>}
                    {it.tag && <span className="tag tag-lang">{it.tag}</span>}
                    {it.category && <span className="tag">{it.category}</span>}
                  </div>
                  {it.title && (
                    <div className="strategy-card-desc" style={{ fontWeight: 500 }}>
                      {it.title}
                    </div>
                  )}
                  {it.description && (
                    <div className="strategy-card-desc">{it.description}</div>
                  )}
                  {it.example && (
                    <div className="strategy-card-example">「{it.example}」</div>
                  )}
                  {it.when_to_use && (
                    <div className="strategy-card-when">何时用：{it.when_to_use}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------- 共用 Banner ----------
function Banner({ kind, title, children }: { kind: 'info' | 'loading' | 'error'; title: string; children: ReactNode }) {
  let bg = 'var(--surface)';
  let border = 'var(--border)';
  let titleColor = 'var(--text)';
  if (kind === 'error') {
    bg = 'color-mix(in srgb, var(--error) 8%, var(--surface))';
    border = 'color-mix(in srgb, var(--error) 35%, transparent)';
  } else if (kind === 'loading') {
    bg = 'var(--surface-light)';
    border = 'var(--border-medium)';
    titleColor = 'var(--text)';
  }
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 12,
      padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: titleColor, fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500 }}>
        {kind === 'loading' && <span className="pulse-dot pulse-soft" />}
        {title}
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

// ---------- 异步辅助：fingerprint 名字查询 ----------
async function fetchFingerprintNames(ids: string[]): Promise<Record<string, { author_name: string; platform: string | null }>> {
  if (ids.length === 0) return {};
  try {
    // 这个端点由 Agent F 负责实现，但我们要预留 fallback：
    // 暂时通过 /api/recommend 在前端 response 里已经返回了 reason，
    // 这里只是补 author_name。Agent F 的 /api/sites/... 不直接给这个；
    // 我们做一次 best-effort：把 fingerprint_id 短码作为名字。
    const params = new URLSearchParams();
    params.set('ids', ids.join(','));
    const resp = await fetch(`/api/fingerprints/names?${params.toString()}`);
    if (resp.ok) {
      const j = await resp.json();
      if (j && typeof j === 'object') return j as Record<string, { author_name: string; platform: string | null }>;
    }
  } catch {/* ignore */}
  // fallback：缺数据时用 id 前缀做名字
  const out: Record<string, { author_name: string; platform: string | null }> = {};
  for (const id of ids) out[id] = { author_name: `指纹 ${id.slice(0, 6)}`, platform: null };
  return out;
}

// ---------- 风格配方挑选面板（Step 4 上方）----------
interface RecipeSummary {
  id: string;
  name: string;
  platform_key: string;
  fragment_ids: string[];
  notes: string | null;
}

interface RecipeDetail {
  id: string;
  name: string;
  platform_key: string;
  notes: string | null;
  fragments: Array<{
    id: string;
    author_name: string | null;
    tag: string | null;
    title: string | null;
    description: string | null;
    example: string | null;
    when_to_use: string | null;
    why_works: string | null;
  }>;
}

/**
 * 把配方碎片转成一段可读的 prompt 注入文本。
 * 调用方把这段塞进 customNotes，下游 outline / draft prompt 已经会把 customNotes 喂给模型。
 */
function recipeToNotes(detail: RecipeDetail): string {
  const lines: string[] = [`# 风格配方 · ${detail.name}`];
  if (detail.notes) lines.push(`备注：${detail.notes}`);
  lines.push('');
  lines.push('参考下面这些策略碎片来写（按出现顺序优先级递减）：');
  for (const f of detail.fragments) {
    const head = [f.title ?? f.tag ?? '碎片', f.author_name ? `（来自 ${f.author_name}）` : '']
      .join('');
    lines.push(`- ${head}`);
    if (f.description) lines.push(`  - ${f.description}`);
    if (f.example) lines.push(`  - 例：「${f.example}」`);
    if (f.when_to_use) lines.push(`  - 适用：${f.when_to_use}`);
  }
  return lines.join('\n');
}

function RecipePickerPanel({
  platformKey,
  selectedRecipeId,
  onSelect,
}: {
  platformKey: PlatformKey | null;
  selectedRecipeId: string | null;
  onSelect: (recipeId: string | null, notes: string | null) => void;
}) {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!platformKey) return;
    setLoading(true);
    fetch(`/api/recipes?platform=${encodeURIComponent(platformKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { items: RecipeSummary[] }) => setRecipes(d.items ?? []))
      .catch(() => setRecipes([]))
      .finally(() => setLoading(false));
  }, [platformKey]);

  const pick = async (recipeId: string) => {
    if (selectedRecipeId === recipeId) {
      // 再点一次 = 取消
      onSelect(null, null);
      return;
    }
    // 拉详情拿 fragments
    const r = await fetch(`/api/recipes/${recipeId}`);
    if (!r.ok) return;
    const d = (await r.json()) as { recipe: RecipeDetail };
    onSelect(recipeId, recipeToNotes(d.recipe));
  };

  return (
    <section
      className="step-card"
      style={{ background: 'var(--surface)', padding: '20px 24px', gap: 12 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p className="step-card-eyebrow" style={{ marginBottom: 4 }}>RECIPE · 风格配方</p>
          <p style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--text)',
            margin: 0,
          }}>
            用现成配方？
            <span style={{
              marginLeft: 8,
              fontSize: 12,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.05em',
            }}>
              选了之后会把碎片自动写进下方备注，再点一次取消
            </span>
          </p>
        </div>
        <a href="/recipes" className="btn btn-ghost" style={{ fontSize: 12 }}>
          管理配方 →
        </a>
      </div>

      {loading && <div style={{ opacity: 0.6, fontSize: 12 }}>加载…</div>}
      {!loading && recipes.length === 0 && (
        <div style={{ opacity: 0.65, fontSize: 12 }}>
          这个平台还没有配方。<a href="/recipes" style={{ color: 'var(--accent)' }}>去 /recipes 建一份</a>，或者跳过这步直接用下方"指纹微调"。
        </div>
      )}
      {!loading && recipes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {recipes.map((r) => {
            const active = r.id === selectedRecipeId;
            return (
              <button
                key={r.id}
                type="button"
                className={'idea-chip' + (active ? ' active' : '')}
                onClick={() => void pick(r.id)}
                title={r.notes ?? `${r.fragment_ids.length} 个碎片`}
                style={
                  active
                    ? {
                        background: 'var(--surface-white)',
                        color: 'var(--text)',
                        borderColor: 'var(--border-medium)',
                      }
                    : undefined
                }
              >
                {r.name} · {r.fragment_ids.length} 片
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
