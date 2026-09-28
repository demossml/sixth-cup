export const isDev = import.meta.env.DEV

export type DevUser = {
  id: number
  phone: string
  nickname: string
  inviteCode: string
  invitedBy: number | null
  cashbackBalance: number
  paidTotal: number
  freeUsed: number
  seq: number
}
