/** @type {import('tailwindcss').Config} */
// Токены визуальной концепции «Кобальт и бумага» (docs/PWA-VISUAL-CONCEPT.md).
// Старые имена (brand.soft, accent.*) сохранены как алиасы, чтобы не ломать страницы.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#002FA7',
          deep: '#001F6B',
          glow: '#1A4DD6',
          tint: '#E6ECFF',
          soft: '#E6ECFF', // алиас прежнего brand-soft
          dark: '#001F6B',
          mid: '#1A6EFF',
          light: '#F5F8FF',
          sub: '#C9D6FF', // вторичный текст на синей шапке (7,4:1 на #002FA7)
        },
        crema: '#C8A26E', // только «подарок»
        accent: {
          orange: '#C8A26E', // алиас: оранжевый убран, остаётся «крема»
          gold: '#C8A26E',
          green: '#1F7A4D',
        },
        page: '#F6F3EE',
        card: '#FFFFFF',
        ink: {
          DEFAULT: '#1B1A17',
          secondary: '#55504A',
          tertiary: '#6B655B',
        },
        line: '#E7E2D9',
        ok: '#1F7A4D',
        warn: { DEFAULT: '#9A5B00', bg: '#FFF4DC' },
        off: { DEFAULT: '#4A5568', bg: '#EEF1F6' },
        bad: '#B4472C',
      },
      fontFamily: {
        sans: ['"Golos Text"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        display: ['"Geologica Variable"', '"Golos Text"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(27, 26, 23, 0.06)',
        lift: '0 10px 24px -10px rgba(0, 31, 107, 0.35)',
        soft: '0 1px 2px rgba(27, 26, 23, 0.06)',
      },
    },
  },
  plugins: [],
}
