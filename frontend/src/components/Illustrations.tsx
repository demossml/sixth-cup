/**
 * Линейные иллюстрации онбординга и пустых состояний (один stroke 1.75, brand + «крема»).
 * Свои SVG в бандле: работают офлайн, ≈1–2 КБ каждая. Не фото и не персонаж.
 */
const B = '#0B4A8D'
const C = '#C8A26E'

export function IllCard() {
  return (
    <svg viewBox="0 0 280 200" width="100%" height="100%" aria-hidden fill="none" stroke={B} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="60" y="34" width="160" height="132" rx="18" fill="#fff" />
      <rect x="82" y="56" width="116" height="116" rx="0" stroke="none" />
      <path d="M92 60h20v20H92zM168 60h20v20h-20zM92 124h20v20H92z" />
      <path d="M132 60h8M148 60h4M132 72h20M124 84h12M146 84h16M92 92h12M112 92h8M128 96h28M168 100h20M92 104h20M124 112h16M148 112h12M168 124h8M180 124h8M124 132h28M164 144h24" />
      <path d="M72 50v-2a6 6 0 0 1 6-6" stroke={C} />
      <path d="M208 150v2a6 6 0 0 1-6 6" stroke={C} />
    </svg>
  )
}

export function IllScan() {
  return (
    <svg viewBox="0 0 280 200" width="100%" height="100%" aria-hidden fill="none" stroke={B} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="40" y="48" width="100" height="100" rx="14" fill="#fff" />
      <path d="M58 66h24v24H58zM98 66h24v24H98zM58 106h24v24H58z" />
      <path d="M98 106h8M114 106h8M98 122h24M106 114v4" />
      <path d="M150 98h40" stroke={C} />
      <path d="M182 90l8 8-8 8" stroke={C} />
      <rect x="200" y="64" width="44" height="72" rx="9" fill="#fff" />
      <path d="M214 74h16" />
      <circle cx="222" cy="122" r="3" />
    </svg>
  )
}

export function IllStamps() {
  const xs = [48, 84, 120, 156, 192]
  return (
    <svg viewBox="0 0 280 200" width="100%" height="100%" aria-hidden fill="none" stroke={B} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {xs.map((x, i) => (
        <g key={x}>
          <circle cx={x} cy="96" r="14" fill={i < 3 ? B : 'none'} strokeDasharray={i < 3 ? undefined : '3 4'} />
          {i < 3 && <path d={`M${x - 5} 96l3.5 3.5 6.5-7`} stroke="#fff" />}
        </g>
      ))}
      <circle cx="232" cy="96" r="16" stroke={C} fill="#fff" />
      <path d="M224 98h16M232 90v16M226 90c0-3 3-4 6-1 3-3 6-2 6 1" stroke={C} />
      <path d="M40 132h200" stroke={B} opacity=".25" />
    </svg>
  )
}
