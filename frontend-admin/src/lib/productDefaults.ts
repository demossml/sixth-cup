/** Черновик нового товара: напиток по умолчанию считается чашкой и доступен как подарок. */
export function newProductDefaults(storeUuids: string[]) {
  return { name: '', price: 0, available: 1, countsAsCup: 1, freeEligible: 1, storeUuids }
}
