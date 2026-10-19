/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0f172a',
          soft: '#eef1f6',
          dark: '#0a0f1a',
          mid: '#172137',
          light: '#f4f2ea',
        },
        accent: {
          yellow: '#fbbf24',
          'yellow-strong': '#f0ae0c',
          'yellow-soft': '#fdf3d4',
          'yellow-ink': '#6b4a05',
          orange: '#92600a',
          gold: '#c8a26e',
          green: '#1f7a5a',
        },
        page: '#f5f0e6',
        surface: '#fffdf8',
        'surface-2': '#f0eadf',
        'surface-3': '#e7dfd0',
        card: '#fffdf8',
        ink: {
          DEFAULT: '#151a24',
          secondary: '#454d5c',
          tertiary: '#626a79',
          faint: '#656d7b',
        },
        line: '#e4ddcf',
        'line-2': '#d3c9b7',
        navy: {
          DEFAULT: '#0f172a',
          2: '#172137',
          3: '#202c46',
          ink: '#f4f2ea',
          muted: '#9aa5b8',
        },
        ok: '#1f7a5a',
        'ok-soft': '#e4f0e9',
        warn: '#92600a',
        'warn-soft': '#f8eed6',
        bad: '#a83a2c',
        'bad-soft': '#fae8e3',
      },
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl: '13px',
        '2xl': '16px',
        '3xl': '20px',
        sm: '9px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(21, 26, 36, 0.04), 0 16px 40px -28px rgba(21, 26, 36, 0.3)',
        soft: '0 1px 2px rgba(21, 26, 36, 0.04), 0 12px 32px -20px rgba(21, 26, 36, 0.22)',
      },
    },
  },
  plugins: [],
}
