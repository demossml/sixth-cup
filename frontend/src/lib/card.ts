/** Номер карты для показа: минимум 4 цифры (0007). Сервер нормализует ведущие нули, кассир может назвать и «7». */
export const formatCardCode = (code: string | null | undefined): string => (code ? code.padStart(4, '0') : '—')
