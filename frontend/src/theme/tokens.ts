/** Design tokens — зеркало tailwind «Кобальт и бумага». */
export const tokens = {
  color: {
    bg: '#F6F3EE', surface: '#FFFFFF', text: '#1B1A17', textMuted: '#55504A',
    textTertiary: '#6B655B', accent: '#002FA7', accentDeep: '#001F6B',
    accentMid: '#1A6EFF', accentTint: '#E6ECFF', success: '#1F7A4D',
    warning: '#9A5B00', danger: '#B4472C', border: '#E7E2D9', crema: '#C8A26E',
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24 },
  space: [4, 8, 12, 16, 24, 32, 48] as const,
  shadow: {
    card: '0 1px 2px rgba(27, 26, 23, 0.06)',
    modal: '0 10px 24px -10px rgba(0, 31, 107, 0.35)',
  },
} as const
