import { config } from '../../config'

export const freeEarned = (paidTotal: number) => Math.floor(paidTotal / config.cupsForFree)

export const cashbackOf = (amount: number) => Math.floor((amount * config.referralCashbackPercent) / 100)
