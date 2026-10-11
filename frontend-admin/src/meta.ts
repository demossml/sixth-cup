import { createContext, useContext } from 'react'

export type Meta = { production: boolean; resetAllowed: boolean }
export const MetaCtx = createContext<Meta>({ production: true, resetAllowed: false })
export const useMeta = () => useContext(MetaCtx)
