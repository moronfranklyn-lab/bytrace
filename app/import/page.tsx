'use client';

import { useState } from 'react';
import { HomeNav } from '@/components/nav/HomeNav';

export default function ImportPage() {
  const [jsonInput, setJsonInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    imported?: number;
    skipped?: number;
    errors?: string[];
    message?: string;
    error?: string;
  } | null>(null);

  const handleImport = async () => {
    if (!jsonInput.trim()) {
      alert('请先粘贴草稿数据');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const drafts = JSON.parse(jsonInput);
      const res = await fetch('/api/import/wechat-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drafts }),
      });

      const data = await res.json();
      setResult(data);

      if (data.ok) {
        setJsonInput('');
      }
    } catch (err) {
      setResult({
        ok: false,
        error: `解析失败: ${(err as Error).message}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <HomeNav activePath="/import" />

      <main className="container" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: 900 }}>
        <header style={{ marginBottom: 32 }}>
          <h1 className="hero-title" style={{ fontSize: 38, margin: '0 0 10px' }}>
            导入<em>公众号草稿</em>
          </h1>
          <p className="hero-subtitle" style={{ fontSize: 15, maxWidth: 620 }}>
            从微信公众号后台批量导入草稿箱文章到历史文章库
          </p>
        </header>

        <div className="step-card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
            步骤 1：打开公众号草稿箱
          </h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
            访问你的公众号后台草稿箱页面：
          </p>
          <a
            href="https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&lang=zh_CN"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: 14 }}
          >
            打开草稿箱 ↗
          </a>
        </div>

        <div className="step-card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
            步骤 2：运行提取脚本
          </h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
            在草稿箱页面，按 <code>F12</code> 打开开发者工具，切换到 <code>Console</code> 标签页，复制下面的脚本并回车：
          </p>
          <pre
            style={{
              background: 'var(--surface)',
              padding: 16,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border)',
            }}
          >
{`// 提取草稿数据
(function() {
  const drafts = [];
  const items = document.querySelectorAll('.appmsg-card__item');

  items.forEach(item => {
    const titleEl = item.querySelector('.appmsg-card__title');
    const timeEl = item.querySelector('.appmsg-card__time');
    const linkEl = item.querySelector('a[href*="appmsg"]');

    if (titleEl && linkEl) {
      drafts.push({
        title: titleEl.textContent.trim(),
        content_html: '', // 需要单独打开文章获取
        create_time: Date.now(),
        update_time: Date.now(),
        url: linkEl.href
      });
    }
  });

  console.log('找到 ' + drafts.length + ' 篇草稿');
  console.log('复制下面的 JSON:');
  console.log(JSON.stringify(drafts, null, 2));

  // 自动复制到剪贴板
  copy(JSON.stringify(drafts));
  alert('已复制 ' + drafts.length + ' 篇草稿数据到剪贴板！');
})();`}
          </pre>
        </div>

        <div className="step-card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
            步骤 3：粘贴并导入
          </h2>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder="将复制的 JSON 数据粘贴到这里..."
            style={{
              width: '100%',
              minHeight: 200,
              padding: 12,
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface)',
              resize: 'vertical',
            }}
          />

          <button
            onClick={handleImport}
            disabled={loading || !jsonInput.trim()}
            className="btn btn-primary"
            style={{ marginTop: 16 }}
          >
            {loading ? '导入中...' : '开始导入'}
          </button>
        </div>

        {result && (
          <div
            className="step-card"
            style={{
              background: result.ok ? 'var(--success-bg)' : 'var(--error-bg)',
              borderColor: result.ok ? 'var(--success)' : 'var(--error)',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
              {result.ok ? '✓ 导入完成' : '✗ 导入失败'}
            </h3>
            {result.message && <p style={{ marginBottom: 8 }}>{result.message}</p>}
            {result.error && <p style={{ color: 'var(--error)' }}>{result.error}</p>}
            {result.errors && result.errors.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
                  查看错误详情 ({result.errors.length})
                </summary>
                <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                  {result.errors.map((err, i) => (
                    <li key={i} style={{ fontSize: 13, color: 'var(--error)' }}>
                      {err}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: 32,
            padding: 16,
            background: 'var(--surface)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--text-muted)',
          }}
        >
          <p style={{ marginBottom: 8 }}>
            <strong>注意：</strong>
          </p>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>当前版本只能导入标题，正文内容需要手动编辑</li>
            <li>重复标题的草稿会自动跳过</li>
            <li>导入后的文章会出现在"历史文章"列表中</li>
          </ul>
        </div>
      </main>
    </>
  );
}
