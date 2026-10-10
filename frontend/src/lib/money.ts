/** Balances are stored in kopecks. Show rubles with kopecks only when there are any: 450 → "4,50", 400 → "4". */
export function formatRub(kopecks: number | null | undefined): string {
  const k = Math.max(0, Math.round(Number(kopecks) || 0))
  const rub = Math.floor(k / 100)
  const cents = k % 100
  const whole = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return cents ? `${whole},${String(cents).padStart(2, '0')}` : whole
}
