/** Design tokens — зеркало brand.67coffee.ru (base.css v2.0). Без тёплых кремов/карамели. */
export const tokens = {
  color: {
    primary: '#0B4A8D',
    bright: '#1769FF',
    deep: '#073561',
    tiffany: '#55D6C2',
    white: '#FFFFFF',
    ice: '#F0F6FF',
    pale: '#DCEBFF',
    ink: '#101B2D',
    muted: '#586B82',
    border: '#D9E6F5',
    // semantic aliases used across PWA
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceAlt: '#F0F6FF',
    text: '#101B2D',
    textMuted: '#586B82',
    textTertiary: '#586B82',
    accent: '#0B4A8D',
    accentDeep: '#073561',
    accentMid: '#1769FF',
    accentTint: '#DCEBFF',
    success: '#1F7A4D',
    warning: '#9A5B00',
    danger: '#B4472C',
    /** @deprecated warm gift accent removed; tiffany marker for gift only */
    crema: '#55D6C2',
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 22 },
  space: [4, 8, 12, 16, 24, 32, 48] as const,
  shadow: {
    card: '0 1px 2px rgba(16, 27, 45, 0.06)',
    modal: '0 10px 24px -10px rgba(7, 53, 97, 0.28)',
  },
  font: {
    display: "'Unbounded', 'Arial Black', sans-serif",
    body: "'Golos Text', 'Helvetica Neue', Arial, sans-serif",
  },
} as const
