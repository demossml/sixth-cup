import { HTTPException } from 'hono/http-exception'

/**
 * HTTPException helper.
 * 500 — internal (e.g. cannot decrypt stored secret).
 * 502/503 — upstream / temporary unavailability.
 */
export const bad = (
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 = 400,
) => new HTTPException(status, { message })
