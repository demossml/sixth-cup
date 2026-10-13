export type Rect = { left: number; right: number; top: number; bottom: number }

export function overlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}
