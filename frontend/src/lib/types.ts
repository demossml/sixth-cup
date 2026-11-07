export type Voucher = [id: number, kind: 'p' | 'f', value: number, expDay: number]

export type CardState = {
  q: number; p: number; f: number; v: Voucher[]; cb: number
}
export type CardProof = CardState & { id: string; t: 'c'; ver: 2; kid: string; i: number; exp: number }
export type ReceiptPayload = CardState & {
  t: 'r'; r: string; u: number; d: number
  dp: number; df: number; dcb: number; vu: number[]; a: number; ts: number
}

export type Directory = {
  serverPub: string
  serverKeys?: { kid: string; pub: string }[]
  cupsForFree: number
  referralCashbackPercent: number
  currency: string
  generatedAt: number
  devices: { id: number; pub: string; revoked: boolean }[]
  stores: {
    id: number; name: string; address: string; organizationId?: number | null
    /** Часы работы: «08:00» … «21:00». null — не заданы (считаем открытой). */
    openTime?: string | null
    closeTime?: string | null
    lat?: number | null
    lng?: number | null
    /** Часы по дням: 7 элементов (0 = Пн), null — выходной. */
    hours?: ({ open: string; close: string } | null)[] | null
    /** Витрина точки: фото 480 (список) и 960 (карточка), ориентир и телефон. */
    photoUrl?: string | null
    photoFullUrl?: string | null
    entranceHint?: string | null
    phone?: string | null
  }[]
  organizations?: {
    id: number; name: string; legalName: string; taxRegime: string; vatRate: number
  }[]
  categories?: { id: number; name: string; sortOrder: number }[]
  products: {
    id: number; name: string; price: number; icon: string
    description?: string | null
    categoryId?: number | null
    imageUrl?: string | null
    sortOrder?: number
    freeEligible?: boolean
    /** КБЖУ на порцию (ккал уже в `calories`). */
    calories?: number | null
    proteinG?: number | null
    fatG?: number | null
    carbsG?: number | null
    /** Блок «Популярное» на экране меню. */
    isPopular?: boolean
    /** Бейдж карточки: hit | seasonal | new. */
    badge?: 'hit' | 'seasonal' | 'new' | null
    /** У товара есть выбор объёма — на карточке «от N ₽». */
    hasVolumes?: boolean
    /** Минимальная цена объёма (или базовая цена). */
    priceFrom?: number
    /** Нет в наличии: карточка видна, но заказать нельзя. */
    soldOut?: boolean
    /** Медиа карточки: фото (imageUrl) или видео (videoUrl + posterUrl). */
    mediaType?: 'image' | 'video'
    videoUrl?: string | null
    posterUrl?: string | null
  }[]
  promos: { id: number; title: string; body: string; icon?: string; sponsor?: string | null; endsAt?: number; imageUrl?: string | null; mediaType?: 'image' | 'video'; placement?: string; badge?: string | null; ctaLabel?: string | null; productId?: number | null; kind?: string }[]
  content?: { id: number; title: string; body?: string; imageUrl?: string | null; mediaType?: 'image' | 'video'; placement?: string; badge?: string | null; ctaLabel?: string | null; productId?: number | null; kind?: string; sortOrder?: number }[]
}

export type Me = {
  id: number; cardId: string; cardCode: string; nickname: string; inviteCode: string; cashbackBalance: number
  /** Серверное состояние лояльности (источник истины — backend). */
  cupsTowardFree?: number; freeAvailable?: number; cupsForFree?: number
  fromFriendsRub?: number; fromFriendsKopecks?: number; friendsCount?: number
  vouchers?: Voucher[]
}
export type StoredReceipt = { id: string; token: string; uploaded: 0 | 1; userId: number; q: number }
