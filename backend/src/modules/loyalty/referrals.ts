import { db } from '../../db'

export function getReferralStats(userId: number) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS total,
      COUNT(DISTINCT from_user_id) AS friends
    FROM cashback_ledger
    WHERE beneficiary_id=?
  `).get(userId) as { total: number; friends: number }

  return {
    friendCashbackTotal: Number(row.total ?? 0),
    friendCount: Number(row.friends ?? 0),
  }
}
