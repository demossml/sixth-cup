import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '../db'

describe('analytics tables exist', () => {
  beforeAll(() => {
    // db module runs migrations on import in app; here just probe
  })
  it('evotor_docs and loyalty_ops readable', () => {
    const a = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name='evotor_docs'`).get() as { n: number }
    const b = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name='loyalty_ops'`).get() as { n: number }
    expect(a.n).toBe(1)
    expect(b.n).toBe(1)
  })
})
