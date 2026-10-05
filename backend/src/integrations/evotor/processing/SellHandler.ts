/**
 * SELL loyalty handler — IMPLEMENT ONLY AFTER Phase 0.6 branch (a) or (b)
 * is recorded in docs/EVOTOR-FACTS.md (MASTER-TZ §2, §9).
 */
export function handleSellNotReady(): never {
  throw new Error(
    'SellHandler blocked: complete Phase 0.6 and set EVOTOR-FACTS.md branch before enabling loyalty processing',
  )
}
