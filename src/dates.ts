// 날짜는 모두 KST 기준 문자열로 다룬다. 'YYYY-MM-DD' 는 문자열 비교로 순서가 맞는다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function kstNow(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}

export function todayKst(d: Date = new Date()): string {
  return kstNow(d).slice(0, 10)
}

// 오늘을 포함해 최근 days 일의 시작 날짜. days=14 이면 오늘부터 13일 전까지다.
export function sinceKst(d: Date, days: number): string {
  return todayKst(new Date(d.getTime() - (days - 1) * 24 * 60 * 60 * 1000))
}
