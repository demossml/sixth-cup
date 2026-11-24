export type PdfTextResult = { text: string; ocrPages: number }

function pdfPageText(items: { [key: string]: unknown }[]): string {
  const lines: { y: number; parts: { x: number; text: string }[] }[] = []
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) continue
    const x = Number(item.transform[4]) || 0
    const y = Number(item.transform[5]) || 0
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 3)
    if (!line) {
      line = { y, parts: [] }
      lines.push(line)
    }
    line.parts.push({ x, text: item.str.trim() })
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(' '))
    .join('\n')
}

export async function extractPdfText(
  file: File,
  onProgress: (message: string) => void = () => undefined,
): Promise<PdfTextResult> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    if (document.numPages > 30) {
      throw new Error('В PDF больше 30 страниц. Разделите документ и загрузите нужную часть.')
    }

    const pageTexts: string[] = []
    const pagesNeedingOcr: number[] = []
    for (let index = 1; index <= document.numPages; index++) {
      onProgress(`Читаю PDF: страница ${index} из ${document.numPages}`)
      const page = await document.getPage(index)
      const content = await page.getTextContent()
      const text = pdfPageText(content.items as { [key: string]: unknown }[]).trim()
      pageTexts[index - 1] = text
      if (text.length < 20) pagesNeedingOcr.push(index)
    }

    if (pagesNeedingOcr.length) {
      onProgress('Сканированные страницы: загружаю локальный OCR-модуль и языковые данные')
      const { createWorker } = await import('tesseract.js')
      const ocr = await createWorker('rus+eng', 1, {
        logger: (message) => {
          if (message.status === 'recognizing text') {
            onProgress(`OCR страницы: ${Math.round(message.progress * 100)}%`)
          }
        },
      })
      try {
        for (const pageNumber of pagesNeedingOcr) {
          const page = await document.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1.8 })
          const canvas = window.document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Не удалось подготовить страницу PDF для OCR')
          await page.render({ canvasContext: context, viewport }).promise
          const result = await ocr.recognize(canvas)
          pageTexts[pageNumber - 1] = result.data.text.trim()
          canvas.width = 0
          canvas.height = 0
        }
      } finally {
        await ocr.terminate()
      }
    }

    const text = pageTexts.filter(Boolean).join('\n')
    if (!text.trim()) throw new Error('В PDF не удалось извлечь текст. Проверьте качество скана или загрузите другой файл.')
    return { text, ocrPages: pagesNeedingOcr.length }
  } finally {
    await document.destroy()
  }
}
