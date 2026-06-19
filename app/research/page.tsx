'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HomeNav } from '@/components/nav/HomeNav';

interface Issue {
  severity: string;
  where: string;
  problem: string;
  suggestion: string;
}
interface Review {
  verdict: string;
  score: number;
  summary: string;
  issues: Issue[];
}

export default function ResearchPage() {
  const [topic, setTopic] = useState('');
  const [hint, setHint] = useState('优先 X(推特)/YouTube 一线从业者一手观点');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [finalMd, setFinalMd] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  const pushLog = (s: string) => setLog((l) => [...l, s]);

  function useThisReport() {
    try {
      sessionStorage.setItem('research_to_compose', JSON.stringify({ topic, md: finalMd }));
    } catch {
      /* ignore */
    }
    router.push('/compose');
  }

  function handleEvent(block: string) {
    const lines = block.split('\n');
    let event = '';
    let dataStr = '';
    for (const l of lines) {
      if (l.startsWith('event: ')) event = l.slice(7).trim();
      else if (l.startsWith('data: ')) dataStr += l.slice(6);
    }
    if (!event) return;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(dataStr);
    } catch {
      /* keep empty */
    }
    switch (event) {
      case 'open':
        setPhase('已连接');
        break;
      case 'gather_start':
        setPhase('codex 联网搜集中…');
        pushLog('① codex 开始联网搜集');
        break;
      case 'gather_done':
        setPhase('搜集完成');
        pushLog(`① 搜集完成（约 ${data.chars} 字素材）`);
        break;
      case 'draft_start':
        setPhase(`claude 4.6 起草中（第 ${data.attempt} 稿）`);
        pushLog(`② 第 ${data.attempt} 稿起草中`);
        setDraft('');
        break;
      case 'draft_delta':
        setDraft((d) => d + (typeof data.delta === 'string' ? data.delta : ''));
        break;
      case 'draft_done':
        pushLog(`② 第 ${data.attempt} 稿完成（约 ${data.chars} 字）`);
        break;
      case 'review_start':
        setPhase(`codex 审查中（第 ${data.attempt} 稿）`);
        pushLog(`③ codex 审查第 ${data.attempt} 稿`);
        break;
      case 'review_done':
        setReview({
          verdict: String(data.verdict),
          score: typeof data.score === 'number' ? data.score : 0,
          summary: String(data.summary ?? ''),
          issues: Array.isArray(data.issues) ? (data.issues as Issue[]) : [],
        });
        pushLog(`③ 审查结论：${data.verdict}（评分 ${data.score}/100，${data.high} 个高危）— ${data.summary}`);
        break;
      case 'review_error':
        pushLog(`③ 审查异常：${data.message}`);
        break;
      case 'revise_start':
        setPhase(`claude 4.6 回炉（第 ${data.attempt} 稿）`);
        pushLog(`④ 按审查意见回炉，第 ${data.attempt} 稿`);
        break;
      case 'done':
        setPhase(data.passed ? '完成（已通过审查）' : '完成（best-of-N 兜底）');
        setFinalMd(typeof data.final_md === 'string' ? data.final_md : '');
        pushLog(`✓ 完成：采用第 ${data.final_attempt} 稿 / 共 ${data.total_attempts} 稿，通过=${data.passed}`);
        break;
      case 'error':
        pushLog(`✗ 出错[${data.phase}]：${data.message}`);
        break;
    }
  }

  async function start() {
    if (topic.trim().length < 8) {
      pushLog('选题太短（至少 8 字）');
      return;
    }
    setRunning(true);
    setPhase('启动…');
    setLog([]);
    setDraft('');
    setReview(null);
    setFinalMd('');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, source_hint: hint }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        pushLog('请求失败：' + res.status);
        setRunning(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) handleEvent(part);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') pushLog('错误：' + (err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
    <HomeNav activePath="/research" />
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 20px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, marginBottom: 8 }}>深度调研</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
        codex 联网搜集 → claude 4.6 起草 → codex 审查 → 按意见回炉。全程走订阅，零 API。
      </p>

      <label style={{ display: 'block', fontSize: 13, marginBottom: 6, color: 'var(--text-tertiary)' }}>
        选题与方向
      </label>
      <textarea
        className="textarea"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="例：AI coding 工具如何重塑软件团队，AI 产品经理该怎么调整方法论"
        disabled={running}
      />

      <label style={{ display: 'block', fontSize: 13, margin: '14px 0 6px', color: 'var(--text-tertiary)' }}>
        取材偏好
      </label>
      <input
        className="input"
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        disabled={running}
      />

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        {!running ? (
          <button className="btn-primary" onClick={start}>开始调研</button>
        ) : (
          <button className="btn-secondary" onClick={() => abortRef.current?.abort()}>中止</button>
        )}
        {phase && <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{phase}</span>}
      </div>

      {log.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>进度</h3>
          {log.map((l, i) => (
            <div key={i} style={{ fontSize: 13, fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>{l}</div>
          ))}
        </div>
      )}

      {draft && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>当前草稿（流式）</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.8 }}>{draft}</pre>
        </div>
      )}

      {review && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>codex 审查：{review.verdict}（评分 {review.score}/100）</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>{review.summary}</p>
          {review.issues.map((it, i) => (
            <div key={i} style={{ marginBottom: 10, fontSize: 14 }}>
              <b>[{it.severity}]</b> {it.where}：{it.problem}
              <br />
              <span style={{ color: 'var(--text-secondary)' }}>→ {it.suggestion}</span>
            </div>
          ))}
        </div>
      )}

      {finalMd && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3>最终报告</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => navigator.clipboard?.writeText(finalMd)}>复制</button>
              <button className="btn-primary" onClick={useThisReport}>用此报告写文 →</button>
            </div>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.8 }}>{finalMd}</pre>
        </div>
      )}
    </main>
    </>
  );
}
