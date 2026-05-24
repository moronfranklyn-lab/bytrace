'use client';

import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react';

interface DeleteConfirmProps {
  /**
   * 触发器元素。任意点击元素都行，会被 clone 注入 onClick。
   */
  trigger: ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
  /** 弹窗里显示的物品名，比如「半佛仙人 · 指纹 v2」 */
  itemName: string;
  /** 自定义副标题，默认"此操作不可撤销"。 */
  hint?: ReactNode;
  /** 确认按钮文案，默认"删除" */
  confirmLabel?: string;
  /** 取消按钮文案，默认"再想想" */
  cancelLabel?: string;
  /** 实际执行删除。可以返回 Promise，期间确认按钮变 loading。 */
  onConfirm: () => void | Promise<void>;
}

/**
 * 通用删除二次确认 modal。文案温暖，不可逆操作必备。
 *
 * 用法：
 *   <DeleteConfirm
 *     trigger={<button className="btn-ghost">删除</button>}
 *     itemName="半佛仙人 · 指纹 v2"
 *     onConfirm={async () => { await fetch('/api/...', {method:'DELETE'}); }}
 *   />
 */
export function DeleteConfirm({
  trigger,
  itemName,
  hint,
  confirmLabel = '删除',
  cancelLabel = '再想想',
  onConfirm,
}: DeleteConfirmProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 调用原始 onClick（如果有）
    if (isValidElement(trigger) && typeof trigger.props.onClick === 'function') {
      trigger.props.onClick(e);
    }
    setOpen(true);
  };

  const handleConfirm = async () => {
    if (busy) return;
    try {
      setBusy(true);
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // 通过 cloneElement 注入 onClick，保留原始样式 / props
  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger, { onClick: handleTriggerClick })
    : trigger;

  return (
    <>
      {triggerEl}
      {open && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div className="delete-confirm" role="dialog" aria-modal="true" aria-label="删除确认">
            <h3 className="delete-confirm-title">
              真的要删除「{itemName}」吗？
            </h3>
            <p className="delete-confirm-hint">
              {hint ?? '此操作不可撤销。删了之后，这位博主的拆解结果就找不回来了。'}
            </p>
            <div className="delete-confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirm}
                disabled={busy}
              >
                {busy ? '正在删除…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
