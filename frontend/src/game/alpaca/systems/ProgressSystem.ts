export function distanceProgress(distance: number, levelLength: number): number {
  if (levelLength <= 0) return 0
  return Math.min(0.99, distance / levelLength)
}
