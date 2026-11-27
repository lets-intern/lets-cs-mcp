// 날짜는 모두 KST 기준 문자열로 다룬다. 'YYYY-MM-DD' 는 문자열 비교로 순서가 맞는다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function kstNow(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}

export function todayKst(d: Date = new Date()): string {
  return kstNow(d).slice(0, 10)
}
