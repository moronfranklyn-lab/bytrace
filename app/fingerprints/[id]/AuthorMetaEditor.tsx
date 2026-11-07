'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  authorId: string;
  authorName: string;
  platform: string | null;
  avatarChar: string;
  createdAtLabel: string;
  fingerprintIdShort: string;
}

// 跟 lib/platforms.ts 的 display name 对齐（"自定义"由内联 input 处理）
const PLATFORM_OPTIONS = [
  '公众号',
  '知乎专栏',
  '少数派',
  '优设',
  '小红书',
  'B 站长视频文案',
  '抖音口播',
  'YouTube 视频文案',
] as const;

const CUSTOM_SENTINEL = '__custom__';

/**
 * 博主头区块的可编辑壳。
 * - name: 单击进入 input 模式，Enter / blur 提交，Esc 取消
 * - platform: 单击切换为 <PlatformEditor>（select + 可选 input + 完成 / 取消按钮）
 * 提交都走 PATCH /api/authors/:id，成功后 router.refresh()。
 */
export function AuthorMetaEditor(props: Props) {
  const router = useRouter();
  const [name, setName] = useState(props.authorName);
  const [editingName, setEditingName] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (patch: { name?: string; platform?: string | null }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/authors/${props.authorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('博主名不能为空');
      setName(props.authorName);
      setEditingName(false);
      return;
    }
    setEditingName(false);
    if (trimmed !== props.authorName) {
      void commit({ name: trimmed });
    }
  };

  return (
    <div className="fp-page-head-left">
      <h1 className="fp-page-title">
        <span
          className="fp-avatar"
          style={{ width: 44, height: 44, marginBottom: 0, fontSize: 18 }}
        >
          {props.avatarChar}
        </span>
        {editingName ? (
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={submitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitName();
              } else if (e.key === 'Escape') {
                setName(props.authorName);
                setEditingName(false);
                setError(null);
              }
            }}
            disabled={saving}
            style={{
              fontFamily: 'inherit',
              fontSize: 'inherit',
              fontWeight: 'inherit',
              padding: '2px 8px',
              border: '1.5px solid var(--accent, currentColor)',
              borderRadius: 6,
              background: 'transparent',
              color: 'inherit',
              minWidth: 200,
            }}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            onClick={() => setEditingName(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setEditingName(true);
              }
            }}
            style={{ cursor: 'text', borderBottom: '1px dashed transparent', padding: '0 2px' }}
            title="点击改名"
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderBottom = '1px dashed currentColor')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderBottom = '1px dashed transparent')
            }
          >
            {props.authorName}
          </span>
        )}
      </h1>
      <div className="fp-page-meta">
        {editingPlatform ? (
          <PlatformEditor
            currentPlatform={props.platform}
            saving={saving}
            onCommit={(next) => {
              setEditingPlatform(false);
              if (next !== props.platform) {
                void commit({ platform: next });
              }
            }}
            onCancel={() => setEditingPlatform(false)}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            onClick={() => setEditingPlatform(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setEditingPlatform(true);
              }
            }}
            style={{ cursor: 'pointer', borderBottom: '1px dashed transparent' }}
            title="点击改平台"
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderBottom = '1px dashed currentColor')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderBottom = '1px dashed transparent')
            }
          >
            {props.platform || '未指定平台'}
          </span>
        )}
        <span className="meta-sep">·</span>
        <span>拆解于 {props.createdAtLabel}</span>
        <span className="meta-sep">·</span>
        <span>id {props.fingerprintIdShort}</span>
        {saving && <span style={{ marginLeft: 8, opacity: 0.6 }}>保存中…</span>}
      </div>
      {error && (
        <div style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginTop: 4 }}>
          没保存上：{error}
        </div>
      )}
    </div>
  );
}

/**
 * 平台编辑面板：select 永远在场，选"自定义"时旁边出现 input。
 * 用「完成 / 取消」按钮显式提交，不依赖 onBlur，避免 select 切到 input 时的 race。
 */
function PlatformEditor({
  currentPlatform,
  saving,
  onCommit,
  onCancel,
}: {
  currentPlatform: string | null;
  saving: boolean;
  onCommit: (next: string | null) => void;
  onCancel: () => void;
}) {
  const isStandard =
    !currentPlatform ||
    (PLATFORM_OPTIONS as readonly string[]).includes(currentPlatform);

  // selectValue 是 select 的 controlled value：标准名字 / '' / CUSTOM_SENTINEL
  const [selectValue, setSelectValue] = useState<string>(
    !currentPlatform ? '' : isStandard ? currentPlatform : CUSTOM_SENTINEL,
  );
  const [customDraft, setCustomDraft] = useState<string>(
    !isStandard && currentPlatform ? currentPlatform : '',
  );

  const customInputRef = useRef<HTMLInputElement | null>(null);

  // 切到自定义时自动 focus
  useEffect(() => {
    if (selectValue === CUSTOM_SENTINEL) {
      customInputRef.current?.focus();
    }
  }, [selectValue]);

  const handleDone = () => {
    if (selectValue === CUSTOM_SENTINEL) {
      const trimmed = customDraft.trim();
      onCommit(trimmed || null);
    } else {
      onCommit(selectValue || null);
    }
  };

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
    >
      <select
        value={selectValue}
        autoFocus
        onChange={(e) => setSelectValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        disabled={saving}
        style={{ padding: '2px 6px', borderRadius: 4 }}
      >
        <option value="">未指定平台</option>
        {PLATFORM_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value={CUSTOM_SENTINEL}>
          自定义{!isStandard && currentPlatform ? `（当前：${currentPlatform}）` : '…'}
        </option>
      </select>

      {selectValue === CUSTOM_SENTINEL && (
        <input
          ref={customInputRef}
          type="text"
          value={customDraft}
          placeholder="输入平台名，如「即刻」「Substack」"
          onChange={(e) => setCustomDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleDone();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          disabled={saving}
          style={{
            fontFamily: 'inherit',
            fontSize: 'inherit',
            padding: '2px 8px',
            border: '1.5px solid var(--accent, currentColor)',
            borderRadius: 4,
            background: 'transparent',
            color: 'inherit',
            minWidth: 160,
          }}
        />
      )}

      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleDone}
        disabled={saving}
        style={{ padding: '2px 10px', fontSize: 12 }}
      >
        完成
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onCancel}
        disabled={saving}
        style={{ padding: '2px 10px', fontSize: 12 }}
      >
        取消
      </button>
    </span>
  );
}
