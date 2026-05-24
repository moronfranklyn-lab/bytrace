import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './stores/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-alt': 'var(--surface-alt)',
        'surface-deep': 'var(--surface-deep)',
        'surface-light': 'var(--surface-light)',
        'surface-white': 'var(--surface-white)',

        border: 'var(--border)',
        'border-medium': 'var(--border-medium)',
        'border-strong': 'var(--border-strong)',

        text: 'var(--text)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'text-muted': 'var(--text-muted)',

        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-soft': 'var(--accent-soft)',
        'hover-rose': 'var(--hover-rose)',

        success: 'var(--success)',
        error: 'var(--error)',
        warning: 'var(--warning)',

        'tint-language': 'var(--tint-language)',
        'tint-structure': 'var(--tint-structure)',
        'tint-topic': 'var(--tint-topic)',
        'tint-visual': 'var(--tint-visual)',

        'primary-btn-bg': 'var(--primary-btn-bg)',
        'primary-btn-text': 'var(--primary-btn-text)',
        'primary-btn-hover': 'var(--primary-btn-hover)',
        'hero-em-color': 'var(--hero-em-color)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        btn: 'var(--radius-btn)',
        card: 'var(--radius-card)',
        pill: 'var(--radius-pill)',
      },
      transitionTimingFunction: {
        smooth: 'var(--ease)',
      },
      transitionDuration: {
        fast: '160ms',
        base: '200ms',
        slow: '280ms',
      },
    },
  },
  plugins: [],
};

export default config;
