import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { streamClaude } from '@/lib/claude';
import { getDb } from '@/lib/db';
import { ensureGatherRunsTable } from '@/lib/schema-additions-gather';
import { ensureKnowledgeBaseTable } from '@/lib/schema-additions-knowledge-base';
import { createSseStream, stripMarkdownFence } from '@/lib/sse';
import { searchWithMimo, isMimoWebSearchConfigured } from '@/lib/search/mimo-web-search';
import { searchWithDoubao, isDoubaoSearchUsable } from '@/lib/search/doubao-web-search';
import { searchWebFacts } from '@/lib/search/web-facts';
import { envStr, TAVILY_KEY_KEYS } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IncomingPayload {
  idea?: string;
}

const MIN_IDEA_CHARS = 30;
const GATHER_TIMEOUT_MS = 360_000;
const TAVILY_API_KEY = () => envStr(...TAVILY_KEY_KEYS) || '';

/** 统一事实搜索命中（MiMo / Tavily / DuckDuckGo / Google CSE） */
interface FactSearchHit {
  title: string;
  url: string;
  content: string;
  score: number;
  source?: string;
}

interface TavilyResponse {
  results: Array<{ title: string; url: string; content: string; score: number }>;
  query: string;
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function hashIdea(idea: string): string {
  return createHash('sha256').update(idea.trim(), 'utf-8').digest('hex').slice(0, 16);
}

function countChars(s: string): number {
  return s.replace(/\s+/g, '').length;
}

/**
 * v3.5 · 联网搜集 API（事实底座）
 *
 * 搜索优先级：
 * 1. MiMo web_search（需控制台开启联网插件）
 * 2. Tavily（若配置 TAVILY_API_KEY）
 * 3. 自带联网搜索：Google CSE > DuckDuckGo（免 key）
 */
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

  try {
    const db = getDb();
    ensureGatherRunsTable(db);
  } catch (err) {
    return jsonError(`数据库结构升级失败：${(err as Error).message}`, 500);
  }

  const ideaHash = hashIdea(idea);

  return createSseStream(async (send, close, signal) => {
    try {
      const db = getDb();

      const cached = db
        .prepare(
          `SELECT idea_hash, material_md, chars, elapsed_ms, created_at
           FROM gather_runs
           WHERE idea_hash = ?`,
        )
        .get(ideaHash) as
        | {
            idea_hash: string;
            material_md: string;
            chars: number;
            elapsed_ms: number | null;
            created_at: number;
          }
        | undefined;

      if (cached) {
        send('cached', {
          idea_hash: ideaHash,
          material_md: cached.material_md,
          chars: cached.chars,
          elapsed_ms: cached.elapsed_ms,
          created_at: cached.created_at,
          from_cache: true,
        });
        send('done', {
          idea_hash: ideaHash,
          material_md: cached.material_md,
          chars: cached.chars,
          elapsed_ms: cached.elapsed_ms,
          from_cache: true,
        });
        close();
        return;
      }

      send('started', { idea_hash: ideaHash });

      const startTime = Date.now();

      const { prompt: gatherPrompt, searchResults, searchQuery, searchEngine } =
        await buildGatherPromptWithSearch(idea);

      send('progress', {
        elapsed_ms: 0,
        search_engine: searchEngine,
        search_hits: searchResults.length,
      });

      const progressInterval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(progressInterval);
          return;
        }
        const elapsed = Date.now() - startTime;
        send('progress', { elapsed_ms: elapsed, search_engine: searchEngine });
      }, 15_000);

      let materialMd = '';

      try {
        materialMd = await streamClaude(gatherPrompt, {
          signal,
          timeoutMs: GATHER_TIMEOUT_MS,
          onChunk: () => {},
        });

        clearInterval(progressInterval);

        materialMd = stripMarkdownFence(materialMd);

        const chars = countChars(materialMd);
        const elapsedMs = Date.now() - startTime;

        try {
          await saveToKnowledgeBase(idea, searchQuery, searchResults, materialMd);
        } catch (err) {
          console.error('[gather] 保存到知识库失败:', err);
        }

        db.prepare(
          `INSERT INTO gather_runs (idea_hash, idea, material_md, chars, elapsed_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(ideaHash, idea, materialMd, chars, elapsedMs, Date.now());

        send('done', {
          idea_hash: ideaHash,
          material_md: materialMd,
          chars,
          elapsed_ms: elapsedMs,
          from_cache: false,
          search_engine: searchEngine,
          search_hits: searchResults.length,
        });
      } catch (err) {
        clearInterval(progressInterval);
        throw err;
      }
    } catch (err) {
      send('error', {
        message: (err as Error).message || '事实底座搜集出了点状况',
      });
    } finally {
      close();
    }
  }, req.signal);
}

async function saveToKnowledgeBase(
  idea: string,
  searchQuery: string,
  searchResults: FactSearchHit[],
  organizedContent: string,
) {
  const db = getDb();
  ensureKnowledgeBaseTable(db);

  const knowledgeId = nanoid(14);
  const now = Date.now();
  const topic = idea.slice(0, 50).trim();
  const keywords = extractSearchKeywords(idea);
  const sourceUrls = searchResults.map((r) => r.url);
  const category = autoDetectCategory(idea);

  db.prepare(
    `INSERT INTO knowledge_base (
      id, topic, category, search_query, raw_results_json,
      organized_content_md, keywords_json, source_urls_json,
      char_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    knowledgeId,
    topic,
    category,
    searchQuery,
    JSON.stringify(searchResults),
    organizedContent,
    JSON.stringify(keywords),
    JSON.stringify(sourceUrls),
    organizedContent.length,
    now,
  );

  const insertTag = db.prepare(
    `INSERT OR IGNORE INTO knowledge_base_tags (knowledge_id, tag) VALUES (?, ?)`,
  );
  for (const keyword of keywords) {
    insertTag.run(knowledgeId, keyword);
  }
  if (category) {
    insertTag.run(knowledgeId, category);
  }

  console.log(`[gather] 已保存到知识库: ${knowledgeId}, 主题: ${topic}`);
}

function autoDetectCategory(idea: string): string {
  const text = idea.toLowerCase();

  if (text.includes('科技') || text.includes('技术') || text.includes('ai') || text.includes('机器人')) {
    return '科技';
  }
  if (text.includes('商业') || text.includes('创业') || text.includes('公司')) {
    return '商业';
  }
  if (text.includes('社会') || text.includes('文化') || text.includes('教育')) {
    return '社会';
  }
  if (text.includes('健康') || text.includes('医疗') || text.includes('养生')) {
    return '健康';
  }
  if (text.includes('娱乐') || text.includes('影视') || text.includes('游戏')) {
    return '娱乐';
  }
  if (text.includes('金融') || text.includes('投资') || text.includes('经济')) {
    return '金融';
  }

  return '综合';
}

async function searchWithTavily(query: string): Promise<FactSearchHit[]> {
  const apiKey = TAVILY_API_KEY();
  if (!apiKey) {
    console.warn('[gather] TAVILY_API_KEY 未配置，跳过 Tavily');
    return [];
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily API 返回错误: ${response.status}`);
    }

    const data = (await response.json()) as TavilyResponse;
    return (data.results || []).map((r) => ({ ...r, source: 'tavily' }));
  } catch (err) {
    console.error('[gather] Tavily 搜索失败:', err);
    return [];
  }
}

function extractSearchKeywords(idea: string): string[] {
  const text = idea.slice(0, 200);
  const stopWords = new Set([
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '个', '为', '上', '要',
    '他', '也', '说', '会', '着', '这', '但', '很', '想', '从', '到', '让', '能', '用', '关于',
    '如何', '什么', '为什么',
  ]);

  const keywords: string[] = [];
  const chars = Array.from(text);
  let currentWord = '';

  for (const char of chars) {
    if (/[一-龥a-zA-Z0-9]/.test(char)) {
      currentWord += char;
    } else {
      if (currentWord.length >= 2 && !stopWords.has(currentWord)) {
        keywords.push(currentWord);
      }
      currentWord = '';
    }
  }
  if (currentWord.length >= 2 && !stopWords.has(currentWord)) {
    keywords.push(currentWord);
  }

  return keywords.slice(0, 5);
}

async function buildGatherPromptWithSearch(idea: string): Promise<{
  prompt: string;
  searchResults: FactSearchHit[];
  searchQuery: string;
  searchEngine: string;
}> {
  const keywords = extractSearchKeywords(idea);
  const searchQuery = keywords.join(' ') || idea.slice(0, 80);

  console.log('[gather] 搜索关键词:', keywords);
  console.log('[gather] 搜索查询:', searchQuery);

  let searchResults: FactSearchHit[] = [];
  let searchEngine = 'none';
  let mimoAnswer = '';

  // 搜索供应商选择：BYTRACE_SEARCH_PROVIDER
  //   auto（默认）= 豆包 → MiMo → Tavily → Google CSE / DuckDuckGo
  //   也可强制 'doubao' / 'mimo' / 'tavily' / 'web-facts'
  const providerPref = (
    envStr('BYTRACE_SEARCH_PROVIDER', 'AUTOARTICLE_SEARCH_PROVIDER') || 'auto'
  ).toLowerCase();

  const wantDoubao = providerPref === 'auto' || providerPref === 'doubao';
  const wantMimo = providerPref === 'auto' || providerPref === 'mimo';
  const wantTavily = providerPref === 'auto' || providerPref === 'tavily';
  const wantWebFacts = providerPref === 'auto' || providerPref === 'web-facts';

  // ① 豆包（火山方舟）联网内容插件
  if (wantDoubao && isDoubaoSearchUsable()) {
    console.log('[gather] 尝试豆包（火山方舟）联网搜索…');
    const doubao = await searchWithDoubao(searchQuery);
    if (doubao.ok) {
      searchResults = doubao.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
        source: 'doubao',
      }));
      if (doubao.answer) mimoAnswer = doubao.answer;
      searchEngine = 'doubao';
      console.log(`[gather] 豆包命中 ${searchResults.length} 条来源（${doubao.searchCount ?? 0} 次搜索）`);
    } else {
      console.warn('[gather] 豆包搜索不可用:', doubao.error);
    }
  }

  // ② MiMo web_search（复用主 Agent 的 MiMo key）
  if (searchResults.length === 0 && !mimoAnswer && wantMimo && isMimoWebSearchConfigured()) {
    console.log('[gather] 尝试 MiMo web_search…');
    const mimo = await searchWithMimo(searchQuery);
    if (mimo.ok) {
      searchResults = mimo.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
        source: 'mimo',
      }));
      mimoAnswer = mimo.answer || '';
      searchEngine = 'mimo';
      console.log(`[gather] MiMo 命中 ${searchResults.length} 条来源`);
    } else {
      console.warn('[gather] MiMo 搜索不可用:', mimo.error);
    }
  }

  // ③ Tavily
  if (searchResults.length === 0 && !mimoAnswer && wantTavily) {
    const tavily = await searchWithTavily(searchQuery);
    if (tavily.length > 0) {
      searchResults = tavily;
      searchEngine = 'tavily';
      console.log('[gather] Tavily 返回结果数:', tavily.length);
    }
  }

  // ④ 免 key 兜底（Google CSE / DuckDuckGo）
  if (searchResults.length === 0 && !mimoAnswer && wantWebFacts) {
    console.log('[gather] 回落自带联网搜索（Google CSE / DuckDuckGo）…');
    const facts = await searchWebFacts(searchQuery);
    if (facts.length > 0) {
      searchResults = facts;
      searchEngine = facts[0]?.source || 'duckduckgo';
      console.log(`[gather] 自带搜索(${searchEngine}) 命中 ${facts.length} 条`);
    } else {
      console.warn('[gather] 所有搜索引擎均无结果，将仅依赖模型知识整理');
    }
  }

  let searchContext = '';
  if (searchResults.length > 0 || mimoAnswer) {
    searchContext = `\n\n## 实时搜索结果（事实底座来源：${searchEngine}）\n\n`;
    if (mimoAnswer) {
      searchContext += `### ${searchEngine === 'mimo' ? 'MiMo' : searchEngine === 'doubao' ? '豆包' : '联网'} 整理\n\n${mimoAnswer.slice(0, 4000)}\n\n`;
    }
    if (searchResults.length > 0) {
      searchContext += '以下是联网检索到的公开来源：\n\n';
      searchResults.forEach((result, idx) => {
        searchContext += `### 来源 ${idx + 1}: ${result.title}\n`;
        searchContext += `- URL: ${result.url}\n`;
        if (result.source) searchContext += `- 引擎: ${result.source}\n`;
        searchContext += `- 内容摘要: ${(result.content || '').slice(0, 400)}\n\n`;
      });
    }
  } else {
    searchContext =
      '\n\n## 搜索状态\n\n网络搜索未返回结果，将基于已有知识整理素材，并明确标注不确定性。\n\n';
  }

  const prompt = `你是一位专业的写作研究助手。我正在准备写一篇文章，需要你帮我收集相关素材。

# 写作题材

${idea}

${searchContext}

# 你的任务

结合上面的实时搜索结果和你的知识，为这个题材提供以下素材。请用 Markdown 格式输出：

## 1. 核心论证素材

### 事实与数据
- 优先使用上面搜索结果中的最新数据
- 补充相关的统计数据、研究结果、权威报告
- 具体数字、百分比、趋势数据
- 注明来源和时间

### 典型案例
- 真实的案例、公司、产品或事件
- 具体的人物、时间、结果
- 正面案例和反面案例都要包含

## 2. 反方观点与争议

- 与核心观点相反或不同的视角
- 学术界或业界的争议点
- 可能的质疑和反驳
- 这部分对增强文章深度很重要

## 3. 背景知识补充

- 读者可能不了解的专业术语、概念
- 技术原理或发展脉络
- 相关领域的基础知识
- 历史背景

## 4. 可引用内容

- 专家观点或名人名言（注明人名和背景）
- 经典的书籍、论文、报告标题
- 行业标准或规范
- 理论框架

## 5. 信息来源汇总

在末尾列出所有引用的来源（包括搜索结果中的 URL）。

---

# 输出要求

- 每条素材要具体、可验证，避免笼统表述
- 数据尽量给出具体数字和范围
- 案例要有名称、时间、结果
- 总篇幅2000-3000字
- 重点是**质量和可用性**
- 明确标注哪些信息来自实时搜索，哪些来自模型知识；搜索没有的数字不要编造

开始收集素材：`;

  return { prompt, searchResults, searchQuery, searchEngine };
}
