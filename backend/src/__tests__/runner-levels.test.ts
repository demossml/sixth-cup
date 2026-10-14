import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-runner-levels-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')

async function guestToken() {
  const response = await app.request('/api/auth/guest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  const body = await response.json() as { token?: string; error?: string }
  expect(response.status).toBe(200)
  expect(body.token).toBeTruthy()
  return body.token as string
}
const postRun = (token: string, body: unknown) => app.request('/api/game/runner/runs', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('runner levels API', () => {
  let token = ''
  beforeAll(async () => { token = await guestToken() })

  it('starts with only L1 unlocked and does not enable monetary rewards', async () => {
    const response = await app.request('/api/game/runner/meta', { headers: { Authorization: `Bearer ${token}` } })
    const body = await response.json() as { levels: { levelId: string; unlocked: boolean }[]; rewardsEnabled: boolean }
    expect(response.status).toBe(200)
    expect(body.levels[0].unlocked).toBe(true)
    expect(body.levels[1].unlocked).toBe(false)
    expect(body.rewardsEnabled).toBe(false)
  })

  it('rejects locked levels and bean over-cap', async () => {
    const locked = await postRun(token, { runId: '11111111-1111-4111-8111-111111111111', levelId: 'alley-rush-02', beansCollected: 0, durationMs: 20_000, completed: true })
    expect(locked.status).toBe(409)
    const overCap = await postRun(token, { runId: '22222222-2222-4222-8222-222222222222', levelId: 'morning-coffee-city-01', beansCollected: 19, durationMs: 20_000, completed: true })
    expect(overCap.status).toBe(400)
  })

  it('records stars once, unlocks L2, and treats duplicate runId idempotently', async () => {
    const runId = '33333333-3333-4333-8333-333333333333'
    const first = await postRun(token, { runId, levelId: 'morning-coffee-city-01', beansCollected: 13, durationMs: 20_000, completed: true })
    expect(first.status).toBe(200)
    const firstBody = await first.json() as { starsEarned: number; duplicate: boolean }
    expect(firstBody.starsEarned).toBe(2)
    expect(firstBody.duplicate).toBe(false)
    const duplicate = await postRun(token, { runId, levelId: 'morning-coffee-city-01', beansCollected: 18, durationMs: 20_000, completed: true })
    expect(duplicate.status).toBe(200)
    expect((await duplicate.json() as { duplicate: boolean }).duplicate).toBe(true)
    const metaResponse = await app.request('/api/game/runner/meta', { headers: { Authorization: `Bearer ${token}` } })
    const meta = await metaResponse.json() as { levels: { levelId: string; unlocked: boolean; completedRuns: number; stars: number }[] }
    expect(meta.levels[0].completedRuns).toBe(1)
    expect(meta.levels[0].stars).toBe(2)
    expect(meta.levels[1].unlocked).toBe(true)
    const user = db.prepare('SELECT cashback_balance AS balance FROM users ORDER BY id DESC LIMIT 1').get() as { balance: number }
    expect(user.balance).toBe(0)
  })
})
