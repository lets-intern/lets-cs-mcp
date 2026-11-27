// 렛츠커리어 어드민 API 클라이언트. 이메일 로그인으로 토큰을 받아 캐시하고, 401 이면 한 번 다시 로그인한다.

type Env = { LETS_API_BASE: string; LETS_ADMIN_EMAIL?: string; LETS_ADMIN_PASSWORD?: string }

type Envelope<T> = { status: number; message?: string; data: T }

// 서버 ChallengeQuestionAdminResponseDto 의 일부. MCP 로 내보낼 때는 개인정보 필드를 뺀다.
export type Question = {
  id: number
  answerStatus: 'WAITING' | 'COMPLETED'
  title: string
  content: string
  answer: string | null
  isVisible: boolean
  challengeId: number
  challengeTitle: string
  userName: string
  challengePricePlanType?: string
  imageUrls?: string[]
  createDate: string
}

export type QuestionList = { questionList: Question[]; pageInfo: unknown }

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const { LETS_API_BASE, LETS_ADMIN_EMAIL, LETS_ADMIN_PASSWORD } = source
  if (!LETS_API_BASE) throw new Error('LETS_API_BASE 가 필요하다')
  // 어드민 계정이 없어도 대시보드는 떠야 한다. 렛츠 API 를 부를 때 확인한다.
  return { LETS_API_BASE, LETS_ADMIN_EMAIL, LETS_ADMIN_PASSWORD }
}

export function createLetsApi(env: Env, fetchImpl: typeof fetch = fetch) {
  let accessToken: string | null = null

  async function login() {
    if (!env.LETS_ADMIN_EMAIL || !env.LETS_ADMIN_PASSWORD) {
      throw new Error('어드민 계정(LETS_ADMIN_EMAIL, LETS_ADMIN_PASSWORD)이 설정되지 않았다')
    }
    const res = await fetchImpl(`${env.LETS_API_BASE}/api/v2/user/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: env.LETS_ADMIN_EMAIL, password: env.LETS_ADMIN_PASSWORD }),
    })
    if (!res.ok) throw new Error(`어드민 로그인 실패: ${res.status}`)
    const body = (await res.json()) as Envelope<{ accessToken: string }>
    accessToken = body.data.accessToken
  }

  async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    if (!accessToken) await login()
    const res = await fetchImpl(`${env.LETS_API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 401 && !retried) {
      accessToken = null
      return request<T>(method, path, body, true)
    }
    if (!res.ok) throw new Error(`${method} ${path} 실패: ${res.status} ${await res.text()}`)
    const text = await res.text()
    return (text ? (JSON.parse(text) as Envelope<T>).data : null) as T
  }

  return {
    listQuestions(params: { challengeId?: number; answerStatus?: 'WAITING' | 'COMPLETED'; page?: number; size?: number }) {
      const q = new URLSearchParams()
      if (params.answerStatus) q.set('answerStatus', params.answerStatus)
      q.set('page', String(params.page ?? 0))
      q.set('size', String(params.size ?? 20))
      const base = params.challengeId
        ? `/api/v2/admin/challenge/${params.challengeId}/questions`
        : '/api/v2/admin/challenge/questions'
      return request<QuestionList>('GET', `${base}?${q}`)
    },
    getQuestion(challengeId: number, questionId: number) {
      return request<Question>('GET', `/api/v2/admin/challenge/${challengeId}/questions/${questionId}`)
    },
    saveAnswer(challengeId: number, questionId: number, answer: string) {
      return request<null>('PATCH', `/api/v2/admin/challenge/${challengeId}/questions/${questionId}/answer`, { answer })
    },
  }
}

export type LetsApi = ReturnType<typeof createLetsApi>
