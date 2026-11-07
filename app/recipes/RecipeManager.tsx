'use client';

import { useEffect, useMemo, useState } from 'react';

interface Recipe {
  id: string;
  name: string;
  platform_key: string;
  site_id: string | null;
  fragment_ids: string[];
  notes: string | null;
  created_at: number;
  updated_at: number;
}

interface Fragment {
  id: string;
  fingerprint_id: string;
  author_name: string | null;
  category: string | null;
  tag: string | null;
  title: string | null;
  description: string | null;
  example: string | null;
  when_to_use: string | null;
  platform_scope: string[];
}

const PLATFORM_KEYS = [
  { key: 'wechat', name: '公众号' },
  { key: 'zhihu', name: '知乎专栏' },
  { key: 'sspai', name: '少数派' },
  { key: 'uisdc', name: '优设' },
  { key: 'xhs', name: '小红书' },
  { key: 'bilibili', name: 'B 站' },
  { key: 'custom', name: '自定义' },
];

function platformLabel(k: string) {
  return PLATFORM_KEYS.find((p) => p.key === k)?.name ?? k;
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function RecipeManager() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true);
    const r = await fetch('/api/recipes');
    if (r.ok) {
      const d = (await r.json()) as { items: Recipe[] };
      setRecipes(d.items);
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreating(true)}
        >
          + 新建配方
        </button>
      </div>

      {creating && (
        <RecipeEditor
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}

      {loading && <div style={{ opacity: 0.6 }}>加载中…</div>}

      {!loading && recipes.length === 0 && !creating && (
        <div
          style={{
            padding: '40px 24px',
            background: 'var(--surface-light)',
            borderRadius: 10,
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          还没建过配方。点上方「新建配方」开始第一份。
        </div>
      )}

      {!loading && recipes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {recipes.map((r) => (
            <RecipeRow key={r.id} recipe={r} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function RecipeRow({ recipe, onChanged }: { recipe: Recipe; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    setDeleting(true);
    await fetch(`/api/recipes/${recipe.id}`, { method: 'DELETE' });
    setDeleting(false);
    onChanged();
  };

  if (editing) {
    return (
      <RecipeEditor
        mode="edit"
        existing={recipe}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <div
      style={{
        background: 'var(--surface-white)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{recipe.name}</span>
          <span className="tag">{platformLabel(recipe.platform_key)}</span>
          <span className="tag" style={{ opacity: 0.65 }}>
            {recipe.fragment_ids.length} 个碎片
          </span>
        </div>
        {recipe.notes && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {recipe.notes}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          更新于 {fmtDate(recipe.updated_at)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setEditing(true)}
          style={{ fontSize: 12 }}
        >
          编辑
        </button>
        {confirmDel ? (
          <button
            type="button"
            className="btn"
            onClick={doDelete}
            disabled={deleting}
            style={{
              background: 'var(--danger, #c0392b)',
              color: '#fff',
              border: 'none',
              fontSize: 12,
            }}
          >
            {deleting ? '删除中…' : '确认删除'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setConfirmDel(true);
              setTimeout(() => setConfirmDel(false), 3000);
            }}
            style={{ color: 'var(--danger, #c0392b)', fontSize: 12 }}
          >
            删除
          </button>
        )}
      </div>
    </div>
  );
}

interface EditorProps {
  mode: 'create' | 'edit';
  existing?: Recipe;
  onClose: () => void;
  onSaved: () => void;
}

function RecipeEditor({ mode, existing, onClose, onSaved }: EditorProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [platform, setPlatform] = useState(existing?.platform_key ?? 'wechat');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [pickedIds, setPickedIds] = useState<string[]>(existing?.fragment_ids ?? []);
  const [pool, setPool] = useState<Fragment[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [filterTag, setFilterTag] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 拉碎片池
  useEffect(() => {
    setPoolLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '60');
    if (filterCategory) params.set('category', filterCategory);
    if (filterTag) params.set('tag', filterTag);
    // platform 用于筛选 platform_scope 包含该平台名（也允许 scope 为空的通用碎片）
    const platformName = platformLabel(platform);
    if (platformName) params.set('platform', platformName);

    fetch(`/api/strategies/search?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { items: Fragment[] }) => setPool(d.items ?? []))
      .catch(() => setPool([]))
      .finally(() => setPoolLoading(false));
  }, [platform, filterCategory, filterTag]);

  const pickedSet = useMemo(() => new Set(pickedIds), [pickedIds]);

  const togglePick = (id: string) => {
    setPickedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError('配方名不能为空');
      return;
    }
    if (pickedIds.length === 0) {
      setError('至少要挑 1 个碎片');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'create') {
        const res = await fetch('/api/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            platform_key: platform,
            fragment_ids: pickedIds,
            notes: notes.trim() || null,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      } else if (existing) {
        const res = await fetch(`/api/recipes/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            fragment_ids: pickedIds,
            notes: notes.trim() || null,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        background: 'var(--surface-white)',
        border: '1.5px solid var(--accent, currentColor)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>
        {mode === 'create' ? '新建风格配方' : `编辑「${existing?.name}」`}
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            配方名
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：公众号 业界动态版"
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 14,
            }}
          />
        </label>
        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            目标平台
          </div>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            disabled={mode === 'edit'}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 14,
            }}
            title={mode === 'edit' ? '编辑模式下不能改平台' : ''}
          >
            {PLATFORM_KEYS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          备注（可选）
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="比如：偏向冷静理性，适合复盘 + 方法论类选题"
          rows={2}
          style={{
            width: '100%',
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 13,
            resize: 'vertical',
          }}
        />
      </label>

      {/* 已选碎片 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          已挑 {pickedIds.length} 个碎片
        </div>
        {pickedIds.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pickedIds.map((pid) => {
              const item = pool.find((p) => p.id === pid);
              return (
                <span
                  key={pid}
                  className="tag"
                  style={{
                    background: 'var(--accent-bg, #e8e2d6)',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  onClick={() => togglePick(pid)}
                  title="点击移除"
                >
                  {item ? `${item.title ?? item.tag ?? pid.slice(0, 6)}（${item.author_name ?? '?'}）` : pid.slice(0, 8)} ×
                </span>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            从下方碎片池里点选
          </div>
        )}
      </div>

      {/* 碎片池过滤 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 4, fontSize: 12 }}
        >
          <option value="">全部类别</option>
          <option value="科技">科技</option>
          <option value="经济金融">经济金融</option>
          <option value="知识科普">知识科普</option>
          <option value="生活情感">生活情感</option>
          <option value="职场创业">职场创业</option>
          <option value="文化娱乐">文化娱乐</option>
          <option value="时事评论">时事评论</option>
          <option value="健康医学">健康医学</option>
        </select>
        <select
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 4, fontSize: 12 }}
        >
          <option value="">全部手法</option>
          <option value="opening">开篇</option>
          <option value="transition">转场</option>
          <option value="closing">收尾</option>
          <option value="argument">论证</option>
          <option value="language">语言</option>
          <option value="hook">钩子</option>
          <option value="pacing">节奏</option>
        </select>
      </div>

      {/* 碎片池 */}
      <div
        style={{
          maxHeight: 360,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 8,
          background: 'var(--surface)',
        }}
      >
        {poolLoading && <div style={{ opacity: 0.6, padding: 8 }}>加载碎片池…</div>}
        {!poolLoading && pool.length === 0 && (
          <div style={{ opacity: 0.6, padding: 8, fontSize: 12 }}>
            这个组合下没碎片。先去拆几个博主。
          </div>
        )}
        {!poolLoading &&
          pool.map((f) => {
            const picked = pickedSet.has(f.id);
            return (
              <div
                key={f.id}
                onClick={() => togglePick(f.id)}
                style={{
                  padding: '8px 10px',
                  marginBottom: 6,
                  background: picked ? 'var(--accent-bg, #e8e2d6)' : 'var(--surface-white)',
                  border: picked
                    ? '1.5px solid var(--accent, currentColor)'
                    : '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{f.title ?? f.tag ?? '(无标题)'}</span>
                  {f.tag && <span className="tag" style={{ fontSize: 10 }}>{f.tag}</span>}
                  {f.category && <span className="tag" style={{ fontSize: 10 }}>{f.category}</span>}
                  {f.author_name && (
                    <span style={{ opacity: 0.65, marginLeft: 'auto' }}>
                      {f.author_name}
                    </span>
                  )}
                </div>
                {f.description && (
                  <div style={{ opacity: 0.85 }}>{f.description}</div>
                )}
                {f.example && (
                  <div style={{ opacity: 0.65, fontStyle: 'italic', marginTop: 2 }}>
                    「{f.example}」
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {error && (
        <div style={{ color: 'var(--danger, #c0392b)', fontSize: 12, marginTop: 8 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
          取消
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : mode === 'create' ? '建好配方' : '保存修改'}
        </button>
      </div>
    </div>
  );
}
