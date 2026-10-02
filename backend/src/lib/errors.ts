import { HTTPException } from 'hono/http-exception'

/** HTTPException helper. 502/503 — для сбоев внешнего SMS-провайдера. */
export const bad = (
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503 = 400,
) => new HTTPException(status, { message })
