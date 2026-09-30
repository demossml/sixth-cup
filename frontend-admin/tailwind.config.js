/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#002FA7',
          soft: '#EEF4FF',
          dark: '#001F6B',
          mid: '#1A6EFF',
          light: '#F5F8FF',
        },
        accent: {
          orange: '#FF6B35',
          gold: '#C8A26E',
          green: '#2B7D5B',
        },
        page: '#F5F5F5',
        card: '#FFFFFF',
        ink: {
          DEFAULT: '#222222',
          secondary: '#666666',
          tertiary: '#999999',
        },
        line: '#E8E8E8',
        ok: '#2B7D5B',
        bad: '#E53935',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(0, 47, 167, 0.06)',
        soft: '0 4px 16px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
}
