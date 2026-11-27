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

// 서버가 주는 'YYYY-MM-DDTHH:mm:ss(.SSS)' 를 'YYYY-MM-DD HH:mm:ss' 로 맞춘다. 서버 시각이 이미 한국 시간이라 그대로 쓴다.
export function normalizeDateTime(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : null
}

// 두 날짜('YYYY-MM-DD ...')의 날짜 차이. 문의가 들어온 날부터 기록한 날까지 며칠인지 센다.
export function daysBetween(from: string, to: string): number {
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((t(to) - t(from)) / 86400000)
}
