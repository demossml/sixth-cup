import { useRef, useState } from 'react'
import { uploadFile } from '../../api/client'
import { Button, Field, Input, useToast } from '../../ui/kit'
import { ImagePlus, Trash2, Video } from 'lucide-react'

export type MediaType = 'image' | 'video'

const IMAGE_LIMIT = 2 * 1024 * 1024
const VIDEO_LIMIT = 20 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
/** Длинная сторона после сжатия: больше серверу не нужно (он режет до 960). */
const MAX_SIDE = 1600
const VIDEO_TYPES = ['video/mp4', 'video/webm']

/**
 * Проверка адреса медиа: пусто, путь на нашем сервере или внешний http(s).
 * Локальный путь (`C:\…`, `/Users/…`, `file://`) браузер и сервер не откроют — его надо не
 * «вставлять», а выбрать файл кнопкой (тогда он уедет на сервер и вернётся как /uploads/…).
 */
export function mediaUrlError(value: string, type: MediaType): string {
  const v = value.trim()
  if (!v) return ''
  if (v.startsWith('/uploads/')) return ''
  if (/^https?:\/\//i.test(v)) return ''
  if (/^file:\/\//i.test(v)) return 'Это путь к файлу на компьютере — выберите его кнопкой ниже, тогда он загрузится на сервер.'
  if (/^[a-zA-Z]:[\\/]/.test(v)) return 'Путь Windows (C:\\…) не подходит: выберите файл кнопкой ниже.'
  if (v.startsWith('/') || v.startsWith('~')) return 'Путь на компьютере не подходит: выберите файл кнопкой ниже.'
  return type === 'video'
    ? 'Укажите ссылку вида /uploads/… или https://… на MP4/WebM.'
    : 'Укажите ссылку вида /uploads/… или https://… на JPG/PNG/WebP.'
}

/**
 * Фото с телефона обычно 4–12 МБ при лимите сервера 2 МБ. Уменьшаем на клиенте:
 * длинная сторона ≤ 1600, качество подбираем так, чтобы уложиться в лимит.
 * Возвращаем исходный файл, если браузер не смог (не критично — сервер ответит понятной ошибкой).
 */
export async function shrinkImage(file: File, limit = IMAGE_LIMIT): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    if (scale === 1 && file.size <= limit) return file

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const encode = (q: number) =>
      new Promise<Blob | null>((resolve) => {
        const webp = canvas.toDataURL('image/webp', q).startsWith('data:image/webp')
        canvas.toBlob(resolve, webp ? 'image/webp' : 'image/jpeg', q)
      })

    for (const q of [0.85, 0.75, 0.65, 0.55]) {
      const blob = await encode(q)
      if (blob && blob.size <= limit) {
        const name = file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.jpg')
        return new File([blob], name, { type: blob.type })
      }
    }
    return file
  } catch {
    return file
  }
}

function fileError(file: File, type: MediaType): string {
  const allowed = type === 'video' ? VIDEO_TYPES : IMAGE_TYPES
  if (!allowed.includes(file.type)) {
    return type === 'video' ? 'Нужен MP4 или WebM.' : 'Нужен JPG, PNG или WebP (iPhone HEIC тоже подойдёт).'
  }
  const limit = type === 'video' ? VIDEO_LIMIT : IMAGE_LIMIT
  if (file.size > limit) {
    return `Файл ${(file.size / 1024 / 1024).toFixed(1)} МБ — больше лимита ${limit / 1024 / 1024} МБ.`
  }
  return ''
}

const humanSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`

/**
 * Медиа контента: адрес, выбор файла с телефона или компьютера, превью и статус загрузки.
 * Успех — только после ответа сервера: `uploadFile` возвращает готовый /uploads/… адрес.
 */
export default function PromoMediaField({
  value,
  mediaType,
  onChange,
}: {
  value: string
  mediaType: MediaType
  onChange: (patch: { imageUrl: string; mediaType?: MediaType }) => void
}) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [error, setError] = useState('')

  const urlError = mediaUrlError(value, mediaType)

  const pick = () => fileRef.current?.click()

  const upload = async (rawFile: File) => {
    const file = mediaType === 'image' && !rawFile.type.startsWith('video/')
      ? await shrinkImage(rawFile)
      : rawFile
    const bad = fileError(file, mediaType)
    if (bad) {
      setError(bad)
      toast.push(bad, 'bad')
      return
    }
    setError('')
    setFileName(file.name)
    setFileSize(file.size)
    setBusy(true)
    try {
      const j = await uploadFile(file)
      onChange({ imageUrl: j.url, mediaType: file.type.startsWith('video/') ? 'video' : 'image' })
      toast.push('Файл загружен на сервер')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка загрузки'
      setError(msg)
      toast.push(msg, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Field
        label={mediaType === 'video' ? 'Адрес видео' : 'Адрес фото'}
        hint="Ссылка на уже загруженный файл. Если файл на телефоне или компьютере — выберите его ниже."
        error={urlError}
      >
        <Input
          value={value}
          onChange={(e) => onChange({ imageUrl: e.target.value })}
          placeholder="/uploads/… или https://…"
          aria-label={mediaType === 'video' ? 'Адрес видео' : 'Адрес фото'}
        />
      </Field>

      <input
        ref={fileRef}
        type="file"
        accept={mediaType === 'video' ? 'video/mp4,video/webm,video/*' : 'image/*'}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void upload(f)
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          onClick={pick}
          icon={mediaType === 'video' ? <Video size={16} /> : <ImagePlus size={16} />}
        >
          {busy ? 'Загружаю…' : mediaType === 'video' ? 'Выбрать видео' : 'Выбрать фото'}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            icon={<Trash2 size={14} />}
            onClick={() => {
              onChange({ imageUrl: '' })
              setFileName('')
              setFileSize(0)
              setError('')
            }}
          >
            Убрать
          </Button>
        ) : null}
      </div>

      {fileName ? (
        <p className="text-[12px] text-ink-secondary">
          {fileName} · {humanSize(fileSize)} ·{' '}
          {busy ? 'загружаю на сервер…' : error ? <span className="text-bad">не загружено</span> : 'загружено'}
        </p>
      ) : null}
      {error ? <p className="text-[12px] text-bad">{error}</p> : null}

      {value && !urlError ? (
        mediaType === 'video' ? (
          <video src={value} controls muted playsInline className="w-full max-h-48 rounded-xl bg-surface-secondary" />
        ) : (
          <img src={value} alt="Предпросмотр" className="w-full max-h-40 object-cover rounded-xl bg-surface-secondary" />
        )
      ) : null}
    </div>
  )
}
