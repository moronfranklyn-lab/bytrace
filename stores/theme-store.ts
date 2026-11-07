import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeId = 'B' | 'C' | 'D';

interface ThemeState {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

/**
 * 主题状态：B（牛皮纸朱砂）/ C（夜书房鎏金）/ D（默认 · 极简松石青）。
 * - 通过 zustand/persist 持久化到 localStorage，key=`autoarticle-theme`
 * - DOM 同步由 <ClientThemeProvider /> 负责（见 components/theme/）
 * - 真正的"默认主题"由 settings 表决定（Agent M），这里的 'D' 仅是 fallback
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'D',
      setTheme: (t) => set({ theme: t }),
    }),
    {
      name: 'autoarticle-theme',
      // 只持久化 theme 字段，避免把 setter 序列化
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
);
