import { config } from '../../config'

export const freeEarned = (paidTotal: number) => Math.floor(paidTotal / config.cupsForFree)

export const cashbackOf = (amount: number) => Math.floor((amount * config.referralCashbackPercent) / 100)

/**
 * Default for a NEW product when the admin did not choose: coffee-like drinks count as a cup
 * (same rule as migration 004). The admin can always override it with the product toggle.
 */
export function looksLikeDrink(name: string, icon?: string | null): boolean {
  const n = name.toLowerCase()
  if (n.includes('печень')) return false
  return icon === 'Coffee'
    || n.includes('латте') || n.includes('капуч') || n.includes('американо') || n.includes('раф')
    || n.includes('кофе') || n.includes('эспрессо') || n.includes('флэт') || n.includes('флет')
}
