/** Normalize RU-centric phones to +7XXXXXXXXXX or +digits */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1)
  if (d.length === 10) d = '7' + d
  return `+${d}`
}
