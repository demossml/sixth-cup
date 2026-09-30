import { HTTPException } from 'hono/http-exception'

export const bad = (message: string, status: 400 | 401 | 403 | 404 | 409 | 429 = 400) =>
  new HTTPException(status, { message })
