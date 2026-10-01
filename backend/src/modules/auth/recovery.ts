import { createHash, randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createRecoveryToken(userId: number) {
  db.prepare('UPDATE customer_recovery SET revoked_at=? WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL').run(Date.now(), userId)
  const token = randomBytes(32).toString('base64url')
  db.prepare(`
    INSERT INTO customer_recovery(user_id, token_hash, created_at)
    VALUES(?,?,?)
  `).run(userId, hashToken(token), Date.now())
  return token
}

export const consumeRecoveryToken = db.transaction((token: string) => {
  const row = db.prepare(`
    SELECT id, user_id
    FROM customer_recovery
    WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  `).get(hashToken(token)) as { id: number; user_id: number } | undefined

  if (!row) throw bad('QR восстановления недействителен или уже использован.', 401)

  db.prepare('UPDATE customer_recovery SET used_at=? WHERE id=?').run(Date.now(), row.id)
  return row.user_id
})
