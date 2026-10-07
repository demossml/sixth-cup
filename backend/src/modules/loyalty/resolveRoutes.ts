import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { resolveAndReserve } from './reservations'

/** Public/device resolve: QR is identity only; server returns live state + short FREE_CUP reservation. */
export const loyaltyResolveRoutes = new Hono()
  .post(
    '/resolve',
    zValidator(
      'json',
      z.object({
        c: z.string().min(1).max(4000),
        storeUuid: z.string().max(80).optional().nullable(),
        terminalId: z.string().max(80).optional().nullable(),
        reserveFree: z.boolean().optional(),
      }),
    ),
    (c) => {
      const body = c.req.valid('json')
      const result = resolveAndReserve({
        cardRef: body.c,
        storeUuid: body.storeUuid,
        terminalId: body.terminalId,
        reserveFree: body.reserveFree,
      })
      return c.json(result)
    },
  )
