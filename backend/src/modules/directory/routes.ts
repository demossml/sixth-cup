import { Hono } from 'hono'
import { config } from '../../config'
import { db } from '../../db'
import { serverPub } from '../../lib/crypto'

export const directoryRoutes = new Hono().get('/', (c) => {
  const now = Math.floor(Date.now() / 1000)
  const devices = db.prepare('SELECT id, public_key AS pub, revoked FROM devices WHERE public_key IS NOT NULL')
    .all() as { id: number; pub: string; revoked: number }[]
  const stores = db.prepare('SELECT id, name, address FROM stores').all() as { id: number; name: string; address: string }[]
  const products = db.prepare('SELECT id, name, price, emoji FROM products WHERE available=1')
    .all() as { id: number; name: string; price: number; emoji: string }[]
  const promos = db.prepare(`SELECT id, title, body, emoji, sponsor, ends_at AS endsAt FROM promos
                             WHERE starts_at<=? AND ends_at>=? ORDER BY id DESC`)
    .all(now, now) as { id: number; title: string; body: string; emoji: string; sponsor: string | null; endsAt: number }[]

  return c.json({
    serverPub,
    cupsForFree: config.cupsForFree,
    referralCashbackPercent: config.referralCashbackPercent,
    currency: config.currency,
    generatedAt: now,
    devices: devices.map((d) => ({ id: d.id, pub: d.pub, revoked: !!d.revoked })),
    stores, products, promos,
  })
})
