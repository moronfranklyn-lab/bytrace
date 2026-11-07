import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  items: ToastItem[];
  show: (message: string, kind?: ToastKind) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const AUTO_DISMISS_MS = 3500;
let _seq = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  show: (message, kind = 'info') => {
    const id = _seq++;
    set((s) => ({ items: [...s.items, { id, message, kind }] }));
    // 自动 3.5s 消失。在测试环境（无 window）跳过定时器。
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        get().dismiss(id);
      }, AUTO_DISMISS_MS);
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  clear: () => set({ items: [] }),
}));
