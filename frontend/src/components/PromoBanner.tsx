/**
 * Баннер акции на главной.
 *
 * По требованию владельца на главной нет никакого текста акции: виден только
 * баннер. Вся информация — на самом плакате. Текст (`title`) используется лишь
 * как доступное имя кнопки для скринридеров и никогда не рисуется.
 *
 * Куда ведёт тап — решает админка (`tap_action`): экран акции с описанием или
 * сразу карточка напитка / меню.
 */
type Props = {
  title: string
  imageUrl: string
  mediaType?: 'image' | 'video'
  /** contain — плакат целиком (подложка по бокам), cover — фото заполняет кадр. */
  fit?: 'contain' | 'cover'
  /** Большой баннер (одна акция) — на всю ширину; иначе карточка рельса. */
  big?: boolean
  onClick: () => void
}

export default function PromoBanner({ title, imageUrl, mediaType, fit = 'contain', big = false, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={title || 'Акция'}
      className={`group block w-full rounded-2xl overflow-hidden shadow-card active:scale-[0.995] motion-reduce:transition-none ${
        fit === 'contain' ? 'bg-brand-soft' : 'bg-brand'
      }`}
    >
      <span
        className={`relative block aspect-[4/5] w-full ${big ? 'max-h-[42vh]' : ''}`}
      >
        {mediaType === 'video' ? (
          <video
            src={imageUrl}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay muted loop playsInline preload="metadata"
            aria-hidden="true"
          />
        ) : (
          <img
            src={imageUrl}
            alt=""
            className={`absolute inset-0 w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
            loading="lazy"
            decoding="async"
          />
        )}
      </span>
    </button>
  )
}
