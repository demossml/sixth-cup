/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#7a4a21',
          soft: '#f6ead9',
          dark: '#5a3518',
          light: '#fff8f0',
        },
        cream: '#fff8f0',
        muted: '#8c7b6b',
        line: '#eadfd2',
        ok: '#1c8a4b',
        bad: '#c2371f',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
      },
    },
  },
  plugins: [],
}
