import type { FC, PropsWithChildren } from 'hono/jsx'
import { templateStatus, type Reply, type Settings, type Template, type TemplateStatus } from './store.js'

// 검정과 흰색만 쓴다. 모서리는 각지게, 구분은 테두리로만 한다.
const css = `
*{box-sizing:border-box;border-radius:0}
body{margin:0;font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#000;background:#fff}
main{max-width:1100px;margin:0 auto;padding:16px}
nav{display:flex;border:2px solid #000}
nav a,nav button{padding:8px 16px;color:#000;text-decoration:none;border:0;border-right:2px solid #000;background:#fff;font:inherit;cursor:pointer}
nav a.on,nav a:hover,nav button:hover{background:#000;color:#fff}
nav form{margin:0 0 0 auto;display:flex}
nav form button{border-right:0;border-left:2px solid #000}
.shell{display:flex;gap:16px;align-items:flex-start;margin-top:16px}
.side{width:200px;flex-shrink:0;border:2px solid #000}
.side a{display:block;padding:8px 12px;color:#000;text-decoration:none;border-bottom:1px solid #000}
.side a:last-child{border-bottom:0}
.side a.on,.side a:hover{background:#000;color:#fff}
.content{flex:1;min-width:0}
.content>.box:first-child{margin-top:0}
@media(max-width:720px){.shell{flex-direction:column}.side{width:100%;display:flex;flex-wrap:wrap}.side a{border-bottom:0;border-right:1px solid #000}}
.box{border:2px solid #000;margin:16px 0;background:#fff}
.box>h2,.box>header{margin:0;padding:6px 12px;background:#000;color:#fff;font-size:14px;font-weight:normal;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.in{padding:12px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
@media(max-width:640px){.stats{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:repeat(2,1fr)}}
.stats .box{margin:16px 0 0}
.stats strong{font-size:28px;display:block}
button,.btn{border:2px solid #000;background:#fff;color:#000;padding:4px 12px;font:inherit;cursor:pointer}
button:hover{background:#000;color:#fff}
button.on{background:#000;color:#fff}
button.on:hover{background:#fff;color:#000}
header button{border-color:#fff;background:#000;color:#fff;padding:0 8px}
header button:hover{background:#fff;color:#000}
input,textarea,select{border:2px solid #000;padding:4px 8px;font:inherit;width:100%;background:#fff;color:#000}
label{display:block;margin:8px 0 2px}
label.inline{display:flex;gap:8px;align-items:center}
label.inline input{width:auto}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
pre,code{font:inherit}
pre{border:2px solid #000;padding:8px;margin:4px 0;white-space:pre-wrap;word-break:break-all}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #000;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#000;color:#fff;font-weight:normal}
.tag{border:1px solid currentColor;padding:0 6px}
.muted{border-top:1px solid #000;margin-top:8px;padding-top:8px}
.actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.wide{max-width:360px;margin:20vh auto}
p{margin:4px 0}
`

const script = `
document.addEventListener('click',function(e){
  var c=e.target.closest('[data-copy]');
  if(c){navigator.clipboard.writeText(c.getAttribute('data-copy'));var t=c.textContent;c.textContent='복사됨';setTimeout(function(){c.textContent=t},1200);return}
  var r=e.target.closest('[data-reveal]');
  if(r){var el=document.getElementById(r.getAttribute('data-reveal'));var on=el.getAttribute('data-on')==='1';
    el.textContent=on?el.getAttribute('data-masked'):el.getAttribute('data-full');el.setAttribute('data-on',on?'0':'1');r.textContent=on?'보기':'숨기기'}
});
`

// 상단은 섹션, 왼쪽은 그 섹션의 하위 메뉴다.
type Section = { key: string; label: string; href: string; subs: { href: string; label: string }[] }

const SECTIONS: Section[] = [
  { key: 'home', label: '대시보드', href: '/', subs: [{ href: '/', label: '현황' }] },
  {
    key: 'connect',
    label: '연결',
    href: '/connect',
    subs: [
      { href: '/connect', label: '서버 주소와 키' },
      { href: '/connect/config', label: 'Claude 설정' },
      { href: '/connect/prompt', label: '예약 실행 프롬프트' },
    ],
  },
  {
    key: 'settings',
    label: '설정',
    href: '/settings',
    subs: [
      { href: '/settings', label: '동작 모드' },
      { href: '/settings/send', label: '전송 설정' },
      { href: '/settings/env', label: '환경' },
    ],
  },
  {
    key: 'templates',
    label: '템플릿',
    href: '/templates',
    subs: [
      { href: '/templates', label: '목록' },
      { href: '/templates/new', label: '새 템플릿' },
    ],
  },
  {
    key: 'debug',
    label: '디버깅',
    href: '/debug',
    subs: [
      { href: '/debug', label: '경과 요약' },
      { href: '/debug/records', label: '기록 목록' },
    ],
  },
  {
    key: 'log',
    label: '기록',
    href: '/log',
    subs: [
      { href: '/log', label: '전체' },
      { href: '/log/drafts', label: '초안' },
    ],
  },
]

// path 는 지금 보고 있는 하위 메뉴의 주소다. 없으면 메뉴 없이 그린다(로그인).
export const Layout: FC<PropsWithChildren<{ title: string; path?: string }>> = ({ title, path, children }) => {
  const section = path ? SECTIONS.find((sec) => sec.subs.some((sub) => sub.href === path)) : undefined
  return (
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{title} - lets-cs</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
      </head>
      <body>
        <main>
          {section ? (
            <>
              <nav>
                {SECTIONS.map((sec) => (
                  <a href={sec.href} class={sec.key === section.key ? 'on' : ''}>{sec.label}</a>
                ))}
                <form method="post" action="/logout"><button type="submit">로그아웃</button></form>
              </nav>
              <div class="shell">
                {section.subs.length > 1 ? (
                  <aside class="side">
                    {section.subs.map((sub) => (
                      <a href={sub.href} class={sub.href === path ? 'on' : ''}>{sub.label}</a>
                    ))}
                  </aside>
                ) : null}
                <div class="content">{children}</div>
              </div>
            </>
          ) : (
            children
          )}
        </main>
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </body>
    </html>
  )
}

export const LoginPage: FC<{ error?: boolean }> = ({ error }) => (
  <Layout title="로그인">
    <form method="post" action="/login" class="box wide">
      <h2>lets-cs 로그인</h2>
      <div class="in">
        <label for="password">비밀번호</label>
        <input id="password" name="password" type="password" required autofocus />
        {error ? <p>비밀번호가 맞지 않다</p> : null}
        <div class="actions"><button type="submit">들어가기</button></div>
      </div>
    </form>
  </Layout>
)

// ---------- 대시보드 ----------

export const ReadOnlyBox: FC<{ readOnly: boolean }> = ({ readOnly }) => (
  <section class="box" id="ro-box">
    <h2>
      읽기 전용 모드 <span class="tag">{readOnly ? '켜짐' : '꺼짐'}</span>
    </h2>
    <div class="in">
      <p>
        {readOnly
          ? '쓰기가 막혀 있다. MCP 에서 reply_question 도구가 사라지고, 대시보드의 초안 전송도 막힌다. 읽기와 템플릿 편집만 된다.'
          : '쓰기가 열려 있다. 답변 초안 저장과 전송이 가능하다.'}
      </p>
      <div class="actions">
        <button
          class={readOnly ? 'on' : ''}
          hx-post="/settings/read-only"
          hx-vals={JSON.stringify({ value: readOnly ? '0' : '1' })}
          hx-target="#ro-box"
          hx-swap="outerHTML"
          hx-confirm={readOnly ? '쓰기를 허용한다. 계속할까?' : undefined}
        >
          {readOnly ? '읽기 전용 끄기 (쓰기 허용)' : '읽기 전용 켜기'}
        </button>
      </div>
    </div>
  </section>
)

export const DebugBox: FC<{ debugMode: boolean }> = ({ debugMode }) => (
  <section class="box" id="debug-box">
    <h2>
      디버깅 모드 <span class="tag">{debugMode ? '켜짐' : '꺼짐'}</span>
    </h2>
    <div class="in">
      <p>
        {debugMode
          ? '유저에게는 아무것도 보내지 않는다. MCP 에서도 대시보드에서도 막혀 있다. 답변은 문의 내용, 참고한 템플릿, 쓴 답변과 함께 기록만 하고, 운영이었다면 자동 전송이었을지 초안이었을지도 남긴다. 이때 자동 전송 설정은 켜졌다고 가정해 판단한다. 경과는 디버깅 탭에서 본다.'
          : '꺼져 있다. 조건을 통과한 답변은 실제로 유저에게 나간다.'}
      </p>
      <div class="actions">
        <button
          class={debugMode ? 'on' : ''}
          hx-post="/settings/debug"
          hx-vals={JSON.stringify({ value: debugMode ? '0' : '1' })}
          hx-target="#debug-box"
          hx-swap="outerHTML"
          hx-confirm={debugMode ? '디버깅 모드를 끈다. 이후 자동 전송 조건을 통과한 답변은 실제로 유저에게 나간다. 계속할까?' : undefined}
        >
          {debugMode ? '디버깅 모드 끄기 (실제 전송 가능)' : '디버깅 모드 켜기'}
        </button>
      </div>
    </div>
  </section>
)

export const Stats: FC<{ activeTemplates: number; drafts: number; sentToday: number; debugToday: number; maxSendPerDay: number }> = (p) => (
  <div class="stats">
    <div class="box"><h2>유효 템플릿</h2><div class="in"><strong>{p.activeTemplates}</strong></div></div>
    <div class="box"><h2>대기 중 초안</h2><div class="in"><strong>{p.drafts}</strong></div></div>
    <div class="box"><h2>오늘 전송</h2><div class="in"><strong>{p.sentToday} / {p.maxSendPerDay}</strong></div></div>
    <div class="box"><h2>오늘 디버깅 기록</h2><div class="in"><strong>{p.debugToday}</strong></div></div>
  </div>
)

const Copyable: FC<{ label: string; shown: string; text: string }> = ({ label, shown, text }) => (
  <div>
    <label>{label}</label>
    <pre>{shown}</pre>
    <button data-copy={text}>복사</button>
  </div>
)

const mask = (key: string) => key.slice(0, 4) + '*'.repeat(12)

export const SCHEDULE_PROMPT = [
  'lets-cs MCP 로 챌린지 문의를 처리한다.',
  '1. get_overview 로 모드와 현황을 본다. readOnly 가 true 면 미답변 문의 수만 세어 보고하고 끝낸다.',
  '2. get_debug_summary 와 list_debug_records 로 지난 디버깅 결과를 점검한다. 같은 유형을 계속 초안으로 처리했거나, 답변이 가이드와 어긋났거나, 템플릿 없이 쓴 문의가 많으면 update_template 으로 고치거나 save_template 으로 새 가이드를 만든다.',
  '3. list_active_templates 로 오늘 유효한 가이드를 읽고, list_pending_questions 로 미답변 문의를 읽는다(page 는 1부터).',
  '4. 문의 하나씩 내용을 읽고 맞는 가이드를 고른다. 가이드 문구를 그대로 복사하지 말고, 그 문의의 상황과 말투에 맞춰 직접 답변을 쓴다. 확인하지 못한 환불, 환급 가능 여부는 단정하지 않는다.',
  '5. reply_question 을 부른다. 참고한 템플릿 id 를 templateId 에 넣고, 템플릿의 autoSend 가 true 면 mode 를 send, 아니면 draft 로 한다. debugMode 가 true 면 유저에게 가지 않고 기록만 되니 평소처럼 진행한다.',
  '6. 맞는 가이드가 없거나 애매한 문의는 건드리지 않는다. 모드와 자동 전송 허용은 바꿀 수 없다.',
  '7. 마지막에 답변한 문의, 건너뛴 문의와 그 이유, 템플릿을 어떻게 고쳤는지를 짧게 보고한다.',
].join('\n')

export const ConnectKeyBox: FC<{ origin: string; token: string }> = ({ origin, token }) => {
  const url = `${origin}/mcp`
  return (
    <section class="box">
      <h2>서버 주소와 키</h2>
      <div class="in">
        <Copyable label="서버 주소" shown={url} text={url} />
        <label>키 (MCP_AUTH_TOKEN)</label>
        <pre>
          <code id="key-view" data-masked={mask(token)} data-full={token} data-on="0">{mask(token)}</code>
        </pre>
        <div class="actions">
          <button data-reveal="key-view">보기</button>
          <button data-copy={token}>키 복사</button>
        </div>
        <p class="muted">호출할 때 Authorization: Bearer 키 헤더로 보낸다. 키는 환경 변수 MCP_AUTH_TOKEN 이다.</p>
      </div>
    </section>
  )
}

export const ConnectConfigBox: FC<{ origin: string; token: string }> = ({ origin, token }) => {
  const url = `${origin}/mcp`
  const cli = (k: string) => `claude mcp add --transport http lets-cs ${url} --header "Authorization: Bearer ${k}"`
  const json = (k: string) =>
    JSON.stringify({ mcpServers: { 'lets-cs': { type: 'http', url, headers: { Authorization: `Bearer ${k}` } } } }, null, 2)
  return (
    <section class="box">
      <h2>Claude 설정</h2>
      <div class="in">
        <Copyable label="Claude Code 에 추가" shown={cli(mask(token))} text={cli(token)} />
        <Copyable label=".mcp.json 설정" shown={json(mask(token))} text={json(token)} />
        <p class="muted">화면에는 키가 가려져 있고, 복사하면 실제 키가 들어간다.</p>
      </div>
    </section>
  )
}

export const PromptBox: FC = () => (
  <section class="box">
    <h2>클라우드 예약 실행 프롬프트</h2>
    <div class="in">
      <Copyable label="예약 실행에 붙여 넣는다" shown={SCHEDULE_PROMPT} text={SCHEDULE_PROMPT} />
    </div>
  </section>
)

export const SettingsBox: FC<{ settings: Settings; saved?: boolean }> = ({ settings, saved }) => (
  <section class="box" id="settings-box">
    <h2>설정</h2>
    <form class="in" hx-post="/settings" hx-target="#settings-box" hx-swap="outerHTML">
      <label class="inline">
        <input type="checkbox" name="autoSendEnabled" checked={settings.autoSendEnabled} />
        자동 전송 허용 (끄면 mode=send 도 모두 초안으로 저장된다. 켜도 디버깅 모드가 켜져 있으면 실제로는 보내지 않는다)
      </label>
      <label for="maxSendPerDay">하루 전송 상한</label>
      <input id="maxSendPerDay" name="maxSendPerDay" type="number" min="1" max="200" value={settings.maxSendPerDay} />
      <label for="answerFooter">답변 끝에 붙일 문구 (전송할 때만 붙는다)</label>
      <textarea id="answerFooter" name="answerFooter" rows={3}>{settings.answerFooter}</textarea>
      <div class="actions">
        <button type="submit">저장</button>
        {saved ? <span class="tag">저장됨</span> : null}
      </div>
    </form>
  </section>
)

export const InfoBox: FC<{ apiBase: string; dbKind: string; dbCreatedAt: string }> = ({ apiBase, dbKind, dbCreatedAt }) => (
  <section class="box">
    <h2>환경</h2>
    <div class="in">
      <p>렛츠 API: {apiBase}</p>
      <p>저장소: {dbKind}</p>
      <p>이 DB 가 처음 열린 시각: {dbCreatedAt}</p>
      <p>키와 대시보드 비밀번호는 환경 변수 MCP_AUTH_TOKEN, DASHBOARD_PASSWORD 로 바꾼다.</p>
    </div>
  </section>
)

// ---------- 템플릿 ----------

const STATUS_LABEL: Record<TemplateStatus, string> = { active: '유효', disabled: '꺼짐', upcoming: '예정', expired: '만료' }

export const TemplateItem: FC<{ t: Template; today: string }> = ({ t, today }) => {
  const status = templateStatus(t, today)
  const period = t.validFrom || t.validUntil ? `${t.validFrom ?? '처음'} ~ ${t.validUntil ?? '계속'}` : '계속 유효'
  return (
    <article class="box" id={`tpl-${t.id}`}>
      <header>
        <strong>{t.title}</strong>
        <span class="tag">{STATUS_LABEL[status]}</span>
        <span class="tag">{period}</span>
        <span class="tag">{t.challengeId ? `챌린지 ${t.challengeId}` : '전체'}</span>
        {t.autoSend ? <span class="tag">자동 전송</span> : null}
        <span class="tag">우선순위 {t.priority}</span>
      </header>
      <div class="in">
        <p>상황: {t.situation}</p>
        <pre>{t.body}</pre>
        <div class="actions">
          <button hx-get={`/templates/${t.id}/edit`} hx-target={`#tpl-${t.id}`} hx-swap="outerHTML">수정</button>
          <button hx-post={`/templates/${t.id}/toggle`} hx-target={`#tpl-${t.id}`} hx-swap="outerHTML">
            {t.enabled ? '끄기' : '켜기'}
          </button>
          <button
            hx-delete={`/templates/${t.id}`}
            hx-target={`#tpl-${t.id}`}
            hx-swap="outerHTML"
            hx-confirm="템플릿을 지운다. 계속할까?"
          >
            삭제
          </button>
        </div>
      </div>
    </article>
  )
}

export const TemplateForm: FC<{ t?: Template }> = ({ t }) => {
  const attrs = t
    ? { 'hx-put': `/templates/${t.id}`, 'hx-target': `#tpl-${t.id}`, 'hx-swap': 'outerHTML' }
    : { 'hx-post': '/templates', 'hx-target': '#tpl-list', 'hx-swap': 'afterbegin', 'hx-on::after-request': 'if(event.detail.successful)this.reset()' }
  return (
    <form class="box" id={t ? `tpl-${t.id}` : 'tpl-new'} {...attrs}>
      <h2>{t ? '템플릿 수정' : '새 템플릿 (답변 가이드)'}</h2>
      <div class="in">
        <label>제목 (상황 이름)</label>
        <input name="title" required value={t?.title ?? ''} />
        <label>이 가이드를 쓸 상황 (Claude 가 이 설명을 보고 고른다)</label>
        <textarea name="situation" rows={2} required>{t?.situation ?? ''}</textarea>
        <label>답변 가이드. 이 문구를 그대로 보내지 않는다. Claude 가 문의에 맞춰 참고해 직접 쓴다</label>
        <textarea name="body" rows={6} required>{t?.body ?? ''}</textarea>
        <div class="row">
          <div><label>챌린지 id (비우면 전체)</label><input name="challengeId" type="number" min="1" value={t?.challengeId ?? ''} /></div>
          <div><label>시작일 (비우면 처음부터)</label><input name="validFrom" type="date" value={t?.validFrom ?? ''} /></div>
          <div><label>종료일 (비우면 계속)</label><input name="validUntil" type="date" value={t?.validUntil ?? ''} /></div>
          <div><label>우선순위</label><input name="priority" type="number" value={t?.priority ?? 0} /></div>
        </div>
        <label class="inline"><input type="checkbox" name="autoSend" checked={t?.autoSend ?? false} />자동 전송 허용</label>
        <div class="actions">
          <button type="submit">{t ? '저장' : '추가'}</button>
          {t ? <button type="button" hx-get={`/templates/${t.id}`} hx-target={`#tpl-${t.id}`} hx-swap="outerHTML">취소</button> : null}
        </div>
      </div>
    </form>
  )
}

export const TemplatesPage: FC<{ templates: Template[]; today: string }> = ({ templates, today }) => (
  <Layout title="템플릿" path="/templates">
    {templates.length === 0 ? (
      <section class="box"><div class="in"><p>템플릿이 없다. 새 템플릿 메뉴에서 만든다.</p></div></section>
    ) : (
      templates.map((t) => <TemplateItem t={t} today={today} />)
    )}
  </Layout>
)

export const TemplatesNewPage: FC = () => (
  <Layout title="새 템플릿" path="/templates/new">
    <TemplateForm />
    <div id="tpl-list" />
  </Layout>
)

const DAY_OPTIONS = [7, 14, 30]

const count = (items: string[]) => {
  const m = new Map<string, number>()
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const DaysBar: FC<{ base: string; days: number }> = ({ base, days }) => (
  <div class="actions">
    {DAY_OPTIONS.map((d) => (
      <a class={`btn${d === days ? ' on' : ''}`} href={`${base}?days=${d}`}>최근 {d}일</a>
    ))}
  </div>
)

export const DebugSummaryPage: FC<{ records: Reply[]; days: number; debugMode: boolean; since: string }> = ({ records, days, debugMode, since }) => {
  const byIntended = count(records.map((r) => (r.intended === 'send' ? '운영이었다면 자동 전송' : '운영이었다면 초안')))
  const byTemplate = count(records.map((r) => r.templateTitle ?? '템플릿 없이 작성'))
  const byDay = count(records.map((r) => r.updatedAt.slice(0, 10))).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  return (
    <Layout title="디버깅 경과" path="/debug">
      <section class="box">
        <h2>
          경과 요약 <span class="tag">{debugMode ? '디버깅 모드 켜짐' : '디버깅 모드 꺼짐'}</span>
        </h2>
        <div class="in">
          <DaysBar base="/debug" days={days} />
          <p>{since} 부터 기록 {records.length}건. 유저에게는 아무것도 보내지 않았다.</p>
        </div>
      </section>
      {records.length === 0 ? (
        <section class="box"><div class="in"><p>이 기간에 디버깅 기록이 없다. 읽기 전용을 끄고 MCP 로 답변을 달면 여기에 쌓인다.</p></div></section>
      ) : (
        <div class="stats" style="grid-template-columns:repeat(3,1fr)">
          <div class="box"><h2>운영이었다면</h2><div class="in">{byIntended.map(([k, n]) => <p>{k}: {n}</p>)}</div></div>
          <div class="box"><h2>참고한 템플릿</h2><div class="in">{byTemplate.map(([k, n]) => <p>{k}: {n}</p>)}</div></div>
          <div class="box"><h2>날짜별</h2><div class="in">{byDay.map(([k, n]) => <p>{k}: {n}</p>)}</div></div>
        </div>
      )}
    </Layout>
  )
}

export const DebugRecordsPage: FC<{ records: Reply[]; days: number; since: string }> = ({ records, days, since }) => (
  <Layout title="디버깅 기록" path="/debug/records">
    <section class="box">
      <h2>기록 목록</h2>
      <div class="in">
        <DaysBar base="/debug/records" days={days} />
        <p>{since} 부터 {records.length}건. 단 답변은 유저에게 보내지 않았다.</p>
      </div>
    </section>
    {records.map((r) => (
      <article class="box">
        <header>
          <strong>문의 #{r.questionId}</strong>
          <span class="tag">{r.updatedAt}</span>
          <span class="tag">{r.challengeTitle ?? `챌린지 ${r.challengeId}`}</span>
          {r.userName ? <span class="tag">{r.userName}</span> : null}
          <span class="tag">{r.templateTitle ? `템플릿: ${r.templateTitle}` : '템플릿 없음'}</span>
          <span class="tag">{r.intended === 'send' ? '운영이었다면 자동 전송' : '운영이었다면 초안'}</span>
        </header>
        <div class="in">
          <p>문의: {r.questionTitle}</p>
          <pre>{r.questionContent ?? '(문의 내용이 기록되지 않았다)'}</pre>
          <p>단 답변 (유저에게 보내지 않음)</p>
          <pre>{r.body}</pre>
          {r.note ? <p>사유: {r.note}</p> : null}
        </div>
      </article>
    ))}
  </Layout>
)

// ---------- 기록 ----------

const REPLY_LABEL: Record<Reply['status'], string> = { draft: '초안', simulated: '디버깅 기록', sent: '전송됨', failed: '실패', discarded: '버림' }

export const LogRow: FC<{ r: Reply; note?: string; canSend?: boolean }> = ({ r, note, canSend = true }) => (
  <tr id={`reply-${r.id}`}>
    <td>{REPLY_LABEL[r.status]}</td>
    <td>#{r.questionId}{r.userName ? ` ${r.userName}` : ''}</td>
    <td>{r.challengeId}</td>
    <td>
      <pre>{r.body}</pre>
      {r.error ? <p>오류: {r.error}</p> : null}
      {r.note ? <p>사유: {r.note}</p> : null}
      {note ? <p>{note}</p> : null}
    </td>
    <td>{r.updatedAt}</td>
    <td>
      {r.status === 'draft' ? (
        <div class="actions">
          {canSend ? (
            <button hx-post={`/replies/${r.id}/send`} hx-target={`#reply-${r.id}`} hx-swap="outerHTML" hx-confirm="고객에게 이 답변을 실제로 보낸다. 계속할까?">전송</button>
          ) : null}
          <button hx-post={`/replies/${r.id}/discard`} hx-target={`#reply-${r.id}`} hx-swap="outerHTML">버리기</button>
        </div>
      ) : null}
    </td>
  </tr>
)

export const LogPage: FC<{ replies: Reply[]; canSend: boolean; path: '/log' | '/log/drafts' }> = ({ replies, canSend, path }) => (
  <Layout title={path === '/log' ? '전체 기록' : '초안'} path={path}>
    <section class="box">
      <h2>{path === '/log' ? '전체 답변 기록' : '초안'}</h2>
      <div class="in">
        {replies.length === 0 ? (
          <p>기록이 없다</p>
        ) : (
          <table>
            <thead>
              <tr><th>상태</th><th>문의</th><th>챌린지</th><th>본문</th><th>시각</th><th>작업</th></tr>
            </thead>
            <tbody>{replies.map((r) => <LogRow r={r} canSend={canSend} />)}</tbody>
          </table>
        )}
      </div>
    </section>
  </Layout>
)

// ---------- 대시보드와 설정, 연결 ----------

export const HomePage: FC<{
  stats: { activeTemplates: number; drafts: number; sentToday: number; debugToday: number; maxSendPerDay: number }
  settings: Settings
}> = ({ stats, settings }) => (
  <Layout title="대시보드" path="/">
    <Stats {...stats} />
    <section class="box">
      <h2>현재 상태</h2>
      <div class="in">
        <p>
          읽기 전용 <span class="tag">{settings.readOnly ? '켜짐' : '꺼짐'}</span> 디버깅 모드{' '}
          <span class="tag">{settings.debugMode ? '켜짐' : '꺼짐'}</span> 자동 전송{' '}
          <span class="tag">{settings.autoSendEnabled ? '허용' : '꺼짐'}</span>
        </p>
        <p>{settings.debugMode ? '유저에게는 아무것도 나가지 않는다.' : '디버깅 모드가 꺼져 있다. 조건을 통과한 답변은 유저에게 나간다.'}</p>
        <div class="actions"><a class="btn" href="/settings">설정에서 바꾼다</a></div>
      </div>
    </section>
  </Layout>
)

export const ConnectPage: FC<{ origin: string; token: string }> = (p) => (
  <Layout title="서버 주소와 키" path="/connect"><ConnectKeyBox {...p} /></Layout>
)
export const ConnectConfigPage: FC<{ origin: string; token: string }> = (p) => (
  <Layout title="Claude 설정" path="/connect/config"><ConnectConfigBox {...p} /></Layout>
)
export const PromptPage: FC = () => (
  <Layout title="예약 실행 프롬프트" path="/connect/prompt"><PromptBox /></Layout>
)

export const SettingsModePage: FC<{ settings: Settings }> = ({ settings }) => (
  <Layout title="동작 모드" path="/settings">
    <ReadOnlyBox readOnly={settings.readOnly} />
    <DebugBox debugMode={settings.debugMode} />
  </Layout>
)
export const SettingsSendPage: FC<{ settings: Settings }> = ({ settings }) => (
  <Layout title="전송 설정" path="/settings/send"><SettingsBox settings={settings} /></Layout>
)
export const SettingsEnvPage: FC<{ apiBase: string; dbKind: string; dbCreatedAt: string }> = (p) => (
  <Layout title="환경" path="/settings/env"><InfoBox {...p} /></Layout>
)
