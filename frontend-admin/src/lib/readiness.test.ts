import { describe, expect, it } from 'vitest'
import { READINESS_KIND_LABEL, READINESS_REASON_LABEL, reasonLabel } from './readiness'

describe('подписи готовности кассы', () => {
  it('каждая причина имеет человеческий текст', () => {
    for (const code of ['no_store_link', 'no_evotor_uuid', 'milk_scheme_empty', 'unavailable']) {
      expect(typeof READINESS_REASON_LABEL[code]).toBe('string')
      expect(READINESS_REASON_LABEL[code].length).toBeGreaterThan(5)
    }
  })

  it('reasonLabel отдаёт текст, код или пустую строку', () => {
    expect(reasonLabel('no_evotor_uuid')).toBe(READINESS_REASON_LABEL.no_evotor_uuid)
    expect(reasonLabel('unknown_code')).toBe('unknown_code')
    expect(reasonLabel(null)).toBe('')
    expect(reasonLabel(undefined)).toBe('')
  })

  it('все виды позиций переведены', () => {
    for (const kind of ['product', 'volume', 'milk', 'addon', 'volume_scheme']) {
      expect(READINESS_KIND_LABEL[kind]).toBeTruthy()
    }
  })
})
