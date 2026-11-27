import { createHash, timingSafeEqual } from 'node:crypto'

// 길이가 달라도 시간이 새지 않게 해시로 맞춰 비교한다.
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
