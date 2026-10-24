/** @type {import('tailwindcss').Config} */
// Токены brand.67coffee.ru — Primary Blue / Ice / White. Без тёплой «бумаги» и крема.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0B4A8D',
          deep: '#073561',
          glow: '#1769FF',
          tint: '#DCEBFF',
          soft: '#F0F6FF',
          dark: '#073561',
          mid: '#1769FF',
          light: '#F0F6FF',
          sub: '#DCEBFF',
        },
        tiffany: '#55D6C2',
        // gift marker (was crema) — tiffany only as point, not fill for text on white
        crema: '#55D6C2',
        accent: {
          orange: '#55D6C2',
          gold: '#55D6C2',
          green: '#1F7A4D',
        },
        night: { DEFAULT: '#073561', soft: '#0B4A8D' },
        page: '#FFFFFF',
        card: '#FFFFFF',
        ice: '#F0F6FF',
        pale: '#DCEBFF',
        ink: {
          DEFAULT: '#101B2D',
          secondary: '#586B82',
          tertiary: '#586B82',
        },
        line: '#D9E6F5',
        ok: '#1F7A4D',
        warn: { DEFAULT: '#9A5B00', bg: '#FFF4DC' },
        off: { DEFAULT: '#586B82', bg: '#F0F6FF' },
        bad: '#B4472C',
      },
      fontFamily: {
        sans: ['"Golos Text"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        display: ['"Unbounded"', '"Golos Text"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '22px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 27, 45, 0.06)',
        lift: '0 10px 24px -10px rgba(7, 53, 97, 0.28)',
        soft: '0 1px 2px rgba(16, 27, 45, 0.06)',
      },
    },
  },
  plugins: [],
}
