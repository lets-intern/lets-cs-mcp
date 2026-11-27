import type { FC, PropsWithChildren } from 'hono/jsx'
import { daysBetween } from './dates.js'
import {
  templateStatus,
  type PolicyDoc,
  type PolicyRevision,
  type Reply,
  type Settings,
  type Template,
  type TemplateStatus,
} from './store.js'

// 검정과 흰색만 쓴다. 모서리는 각지게, 구분은 테두리로만 한다.
const css = `
*{box-sizing:border-box;border-radius:0}
body{margin:0;font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#000;background:#fff}
main{max-width:1100px;margin:0 auto;padding:16px}
nav{display:flex;border:2px solid #000}
nav a,nav button{padding:8px 16px;color:#000;text-decoration:none;border:0;border-right:2px solid #000;background:#fff;font:inherit;cursor:pointer}
nav a.on,nav a:hover,nav button:hover{background:#000;color:#fff}
nav form{margin:0;display:flex}
nav form button{border-right:0;border-left:2px solid #000}
.shell{display:flex;gap:16px;align-items:flex-start;margin-top:16px}
.side{width:200px;flex-shrink:0;border:2px solid #000}
.side a{display:block;padding:8px 12px;color:#000;text-decoration:none;border-bottom:1px solid #000}
.side a:last-child{border-bottom:0}
.side a.on,.side a:hover{background:#000;color:#fff}
.content{flex:1;min-width:0}
.content>.box:first-child{margin-top:0}
@media(max-width:720px){.shell{flex-direction:column}.side{width:100%;display:flex;flex-wrap:wrap}.side a{border-bottom:0;border-right:1px solid #000}}
.cols{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px;align-items:start}
@media(max-width:900px){.cols{grid-template-columns:1fr}}
.step{display:flex;border:2px solid #000;background:#fff}
.step .no{background:#000;color:#fff;width:44px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.step .body{padding:8px 12px;flex:1;min-width:0}
.step .tools{margin-top:4px}
.step .tools code{border:1px solid #000;padding:0 4px;margin:0 4px 4px 0;display:inline-block}
.conn{height:22px;border-left:2px solid #000;margin-left:21px;position:relative}
.conn::after{content:'';position:absolute;bottom:-1px;left:-7px;border:6px solid transparent;border-top:8px solid #000;border-bottom:0}
.branch{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
@media(max-width:900px){.branch{grid-template-columns:1fr}}
.branch>div{border:2px solid #000;padding:8px}
.branch .head{background:#000;color:#fff;margin:-8px -8px 6px;padding:4px 8px}
.stop{border:2px dashed #000;padding:6px 10px;margin-top:8px}
.trigger{border:2px solid #000;background:#000;color:#fff;padding:8px 12px}
nav a.wf{margin-left:auto;border-right:0;border-left:2px solid #000}
.bar{display:flex;align-items:center;gap:8px;margin:6px 0}
.bar .label{width:42%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .track{flex:1;border:1px solid #000;height:16px}
.bar .fill{background:#000;height:100%}
.bar .n{width:36px;text-align:right}
.split{display:flex;border:2px solid #000;height:28px;margin:8px 0}
.split .a{background:#000}
.hint{border:2px solid #000;padding:8px 12px;margin:0 0 8px}
.lead{margin:0 0 8px}
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
    key: 'policies',
    label: '정책',
    href: '/policies',
    subs: [
      { href: '/policies', label: '목록' },
      { href: '/policies/new', label: '새 정책' },
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
    key: 'workflow',
    label: '워크플로우',
    href: '/workflow',
    subs: [
      { href: '/workflow', label: '흐름도' },
      { href: '/workflow/doc', label: '운영 문서' },
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
                {SECTIONS.filter((sec) => sec.key !== 'workflow').map((sec) => (
                  <a href={sec.href} class={sec.key === section.key ? 'on' : ''}>{sec.label}</a>
                ))}
                <a href="/workflow" class={`wf${section.key === 'workflow' ? ' on' : ''}`}>워크플로우</a>
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
        {t.policyIds.length > 0 ? <span class="tag">정책 {t.policyIds.map((i) => `#${i}`).join(', ')}</span> : null}
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
        <label>근거 정책 문서 번호 (쉼표로 구분, 정책 메뉴의 # 번호)</label>
        <input name="policyIds" value={t?.policyIds.join(', ') ?? ''} />
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

const Bars: FC<{ rows: [string, number][] }> = ({ rows }) => {
  const max = Math.max(1, ...rows.map(([, n]) => n))
  return (
    <div>
      {rows.map(([label, n]) => (
        <div class="bar">
          <span class="label" title={label}>{label}</span>
          <span class="track"><span class="fill" style={`display:block;width:${Math.max(3, Math.round((n / max) * 100))}%`} /></span>
          <span class="n">{n}</span>
        </div>
      ))}
    </div>
  )
}

export const DebugSummaryPage: FC<{
  records: Reply[]
  days: number
  debugMode: boolean
  since: string
  policies: { used: { id: number; title: string; count: number }[]; unused: { id: number; title: string }[]; recordsWithoutPolicy: number }
}> = ({ records, days, debugMode, since, policies }) => {
  const total = records.length
  const autoCount = records.filter((r) => r.intended === 'send').length
  const draftCount = total - autoCount
  const noTemplate = records.filter((r) => !r.templateId).length
  const byTemplate = count(records.map((r) => r.templateTitle ?? '템플릿 없이 작성'))
  const byDay = count(records.map((r) => r.updatedAt.slice(0, 10))).sort((a, b) => (a[0] > b[0] ? 1 : -1))
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100))
  return (
    <Layout title="디버깅 경과" path="/debug">
      <section class="box">
        <h2>
          경과 요약 <span class="tag">{debugMode ? '디버깅 모드 켜짐' : '디버깅 모드 꺼짐'}</span>
        </h2>
        <div class="in">
          <DaysBar base="/debug" days={days} />
          <p class="lead">{since} 부터 오늘까지. 유저에게는 아무것도 보내지 않았다. 아래는 AI 가 문의에 단 답변을 기록해 센 결과다.</p>
          <div class="stats" style="margin-top:8px">
            <div class="box"><h2>기록</h2><div class="in"><strong>{total}</strong>건</div></div>
            <div class="box"><h2>운영이었다면 자동 전송</h2><div class="in"><strong>{autoCount}</strong>{pct(autoCount)}%</div></div>
            <div class="box"><h2>운영이었다면 초안</h2><div class="in"><strong>{draftCount}</strong>{pct(draftCount)}%</div></div>
            <div class="box"><h2>템플릿 없이 작성</h2><div class="in"><strong>{noTemplate}</strong>건</div></div>
          </div>
        </div>
      </section>

      {total === 0 ? (
        <section class="box"><div class="in"><p>이 기간에 디버깅 기록이 없다. 읽기 전용을 끄고 MCP 로 답변을 달면 여기에 쌓인다.</p></div></section>
      ) : (
        <>
          <section class="box">
            <h2>운영이었다면 어떻게 처리됐나</h2>
            <div class="in">
              <p class="lead">디버깅 모드가 아니었다면 자동 전송으로 나갔을 답변과 사람 확인이 필요한 초안의 비율이다.</p>
              <div class="split" title={`자동 전송 ${autoCount} / 초안 ${draftCount}`}>
                <span class="a" style={`width:${pct(autoCount)}%`} />
              </div>
              <p>검은 부분 자동 전송 {autoCount}건 ({pct(autoCount)}%), 흰 부분 초안 {draftCount}건 ({pct(draftCount)}%)</p>
              {autoCount === 0 ? (
                <p class="hint">
                  자동 전송 후보가 하나도 없다. 템플릿의 자동 전송이 모두 꺼져 있기 때문이다. 위험이 낮은 템플릿(자료 위치, 미션 제출 방법 등)만
                  템플릿 → 목록에서 자동 전송을 허용하면 그 유형이 여기에 자동 전송으로 집계된다. 디버깅 모드가 켜져 있어 허용해도 유저에게는 나가지 않는다.
                </p>
              ) : null}
            </div>
          </section>

          <section class="box">
            <h2>어떤 유형이 많았나</h2>
            <div class="in">
              <p class="lead">답변에 참고한 템플릿별 건수다. 한 곳에 몰리면 나누고, 템플릿 없이 쓴 문의가 많으면 새 템플릿이 필요하다.</p>
              <Bars rows={byTemplate} />
            </div>
          </section>

          {policies.used.length + policies.unused.length > 0 ? (
            <section class="box">
              <h2>정책 문서는 얼마나 쓰였나</h2>
              <div class="in">
                <p class="lead">답변에 근거로 넣은 정책 번호를 센 것이다. 정책이 걸린 문의인데 근거 없이 쓴 답변이 많으면 정책을 안 읽고 답한 것이다.</p>
                <Bars rows={policies.used.map((u) => [`#${u.id} ${u.title}`, u.count] as [string, number])} />
                <p>근거 정책 없이 쓴 답변 {policies.recordsWithoutPolicy}건</p>
                {policies.unused.length > 0 ? (
                  <p class="hint">한 번도 근거로 쓰이지 않은 정책: {policies.unused.map((u) => `#${u.id} ${u.title}`).join(', ')}</p>
                ) : null}
              </div>
            </section>
          ) : null}

          <section class="box">
            <h2>날짜별</h2>
            <div class="in">
              <p class="lead">하루에 몇 건을 처리했는지다. 0건인 날은 예약 실행이 돌지 않은 것이다.</p>
              <Bars rows={byDay} />
            </div>
          </section>
        </>
      )}
    </Layout>
  )
}

const DebugRecordCard: FC<{ r: Reply; policyTitles: Record<number, string> }> = ({ r, policyTitles }) => (
  <article class="box">
    <header>
      <strong>문의 #{r.questionId}</strong>
      <span class="tag">문의 접수 {r.questionCreatedAt ?? '저장 전 기록'}</span>
      <span class="tag">기록 {r.createdAt}</span>
      {r.updatedAt !== r.createdAt ? <span class="tag">수정 {r.updatedAt}</span> : null}
      {lagText(r) ? <span class="tag">{lagText(r)}</span> : null}
      <span class="tag">{r.challengeTitle ?? `챌린지 ${r.challengeId}`}</span>
      {r.userName ? <span class="tag">{r.userName}</span> : null}
      <span class="tag">{r.templateTitle ? `템플릿: ${r.templateTitle}` : '템플릿 없음'}</span>
      <span class="tag">{r.intended === 'send' ? '운영이었다면 자동 전송' : '운영이었다면 초안'}</span>
      <span class="tag">{r.policyIds.length > 0 ? `근거 정책 ${r.policyIds.map((i) => `#${i} ${policyTitles[i] ?? ''}`.trim()).join(', ')}` : '근거 정책 없음'}</span>
    </header>
    <div class="in">
      <p>문의: {r.questionTitle}</p>
      <pre>{r.questionContent ?? '(문의 내용이 기록되지 않았다)'}</pre>
      <p>단 답변 (유저에게 보내지 않음)</p>
      <pre>{r.body}</pre>
      {r.note ? <p>사유: {r.note}</p> : null}
    </div>
  </article>
)

export const DebugRecordCards: FC<{ records: Reply[]; policyTitles: Record<number, string>; next: string | null }> = ({ records, policyTitles, next }) => (
  <>
    {records.map((r) => <DebugRecordCard r={r} policyTitles={policyTitles} />)}
    {next ? <MoreBlock href={next} /> : null}
  </>
)

export const DebugRecordsPage: FC<{
  records: Reply[]
  total: number
  next: string | null
  days: number
  since: string
  policyTitles: Record<number, string>
  anyMissingDate: boolean
}> = ({ records, total, next, days, since, policyTitles, anyMissingDate }) => (
  <Layout title="디버깅 기록" path="/debug/records">
    <section class="box">
      <h2>기록 목록</h2>
      <div class="in">
        <DaysBar base="/debug/records" days={days} />
        <p>{since} 부터 {total}건. 단 답변은 유저에게 보내지 않았다.</p>
        {total > 0 ? <OrderNote total={total} shown={Math.min(total, records.length)} /> : null}
        <BackfillButton show={anyMissingDate} />
      </div>
    </section>
    <DebugRecordCards records={records} policyTitles={policyTitles} next={next} />
  </Layout>
)

export const MoreRow: FC<{ href: string; cols: number }> = ({ href, cols }) => (
  <tr hx-get={href} hx-trigger="revealed" hx-swap="outerHTML">
    <td colspan={cols}>더 불러오는 중...</td>
  </tr>
)

export const MoreBlock: FC<{ href: string }> = ({ href }) => (
  <div class="box" hx-get={href} hx-trigger="revealed" hx-swap="outerHTML">
    <div class="in">더 불러오는 중...</div>
  </div>
)

const OrderNote: FC<{ total: number; shown: number }> = ({ total, shown }) => (
  <p class="lead">최신순. 총 {total}건 중 {shown}건을 보고 있다. 아래로 내리면 이어서 불러온다.</p>
)

// ---------- 정책 ----------

const safeHref = (url: string) => (/^https?:\/\//.test(url) ? url : null)

export const PolicyItem: FC<{ p: PolicyDoc }> = ({ p }) => {
  const href = safeHref(p.sourceUrl)
  return (
    <article class="box" id={`policy-${p.id}`}>
      <header>
        <strong>#{p.id} {p.title}</strong>
        <span class="tag">{p.enabled ? '사용 중' : '꺼짐'}</span>
        {p.owner ? <span class="tag">담당 {p.owner}</span> : null}
        <span class="tag">마지막 수정 {p.lastEditor} {p.updatedAt}</span>
        {p.tags.map((t) => <span class="tag">{t}</span>)}
      </header>
      <div class="in">
        {p.summary ? <p>요약: {p.summary}</p> : null}
        {p.appliesWhen ? <p>적용 상황: {p.appliesWhen}</p> : null}
        {href ? <p>원문: <a href={href} target="_blank" rel="noopener noreferrer">{href}</a></p> : null}
        <details>
          <summary>본문 보기 ({p.body.length}자)</summary>
          <pre>{p.body}</pre>
        </details>
        <div id={`policy-hist-${p.id}`} />
        <div class="actions">
          <button hx-get={`/policies/${p.id}/edit`} hx-target={`#policy-${p.id}`} hx-swap="outerHTML">수정</button>
          <button hx-get={`/policies/${p.id}/history`} hx-target={`#policy-hist-${p.id}`} hx-swap="innerHTML">수정 이력</button>
          <button hx-post={`/policies/${p.id}/toggle`} hx-target={`#policy-${p.id}`} hx-swap="outerHTML">
            {p.enabled ? '끄기' : '켜기'}
          </button>
          <button hx-delete={`/policies/${p.id}`} hx-target={`#policy-${p.id}`} hx-swap="outerHTML" hx-confirm="정책 문서와 이력을 지운다. 되돌릴 수 없다. 계속할까?">
            삭제
          </button>
        </div>
      </div>
    </article>
  )
}

export const PolicyHistory: FC<{ p: PolicyDoc; revisions: PolicyRevision[] }> = ({ p, revisions }) => (
  <div class="muted">
    {revisions.length === 0 ? (
      <p>고친 이력이 없다.</p>
    ) : (
      revisions.map((r) => (
        <details>
          <summary>
            {r.createdAt} {r.replacedBy} 가 고침: {r.editNote || '사유 없음'}
          </summary>
          <p>그 이전 내용: {r.title}</p>
          {r.summary ? <p>요약: {r.summary}</p> : null}
          <pre>{r.body}</pre>
          <div class="actions">
            <button
              hx-post={`/policies/${p.id}/restore/${r.id}`}
              hx-target={`#policy-${p.id}`}
              hx-swap="outerHTML"
              hx-confirm="이 이전 내용으로 되돌린다. 지금 내용은 이력에 남는다. 계속할까?"
            >
              이 내용으로 되돌리기
            </button>
          </div>
        </details>
      ))
    )}
  </div>
)

export const PolicyForm: FC<{ p?: PolicyDoc }> = ({ p }) => {
  const attrs = p
    ? { 'hx-put': `/policies/${p.id}`, 'hx-target': `#policy-${p.id}`, 'hx-swap': 'outerHTML' }
    : { 'hx-post': '/policies', 'hx-target': '#policy-list', 'hx-swap': 'afterbegin', 'hx-on::after-request': 'if(event.detail.successful)this.reset()' }
  return (
    <form class="box" id={p ? `policy-${p.id}` : 'policy-new'} {...attrs}>
      <h2>{p ? `정책 문서 수정 #${p.id}` : '새 정책 문서'}</h2>
      <div class="in">
        <label>제목</label>
        <input name="title" required value={p?.title ?? ''} />
        <label>한 줄 요약</label>
        <input name="summary" value={p?.summary ?? ''} />
        <label>어떤 문의에 적용되나 (AI 가 이 설명을 보고 문서를 고른다)</label>
        <textarea name="appliesWhen" rows={2}>{p?.appliesWhen ?? ''}</textarea>
        <div class="row" style="grid-template-columns:repeat(3,1fr)">
          <div><label>태그 (쉼표로 구분)</label><input name="tags" value={p?.tags.join(', ') ?? ''} /></div>
          <div><label>담당자</label><input name="owner" value={p?.owner ?? ''} /></div>
          <div><label>원문 주소 (Notion)</label><input name="sourceUrl" value={p?.sourceUrl ?? ''} /></div>
        </div>
        <label>본문 (원문 그대로)</label>
        <textarea name="body" rows={16} required>{p?.body ?? ''}</textarea>
        <div class="actions">
          <button type="submit">{p ? '저장' : '추가'}</button>
          {p ? <button type="button" hx-get={`/policies/${p.id}`} hx-target={`#policy-${p.id}`} hx-swap="outerHTML">취소</button> : null}
        </div>
      </div>
    </form>
  )
}

export const PolicyItems: FC<{ policies: PolicyDoc[]; next: string | null }> = ({ policies, next }) => (
  <>
    {policies.map((p) => <PolicyItem p={p} />)}
    {next ? <MoreBlock href={next} /> : null}
  </>
)

export const PoliciesPage: FC<{ policies: PolicyDoc[]; total: number; next: string | null }> = ({ policies, total, next }) => (
  <Layout title="정책 문서" path="/policies">
    <section class="box">
      <h2>운영정책 문서 {total}건</h2>
      <div class="in">
        <p>호정님과 경지님이 정한 운영정책이다. AI 는 읽고, 요약과 태그, 본문 구조를 정리할 수 있다. 고칠 때마다 이전 내용이 이력에 남고 여기서 되돌릴 수 있다. 삭제는 여기서 사람만 한다.</p>
        {total > 0 ? <OrderNote total={total} shown={Math.min(total, policies.length)} /> : null}
      </div>
    </section>
    <div id="policy-list">
      {policies.length === 0 ? (
        <section class="box"><div class="in"><p>정책 문서가 없다. 새 정책 메뉴에서 넣는다.</p></div></section>
      ) : (
        <PolicyItems policies={policies} next={next} />
      )}
    </div>
  </Layout>
)

export const PoliciesNewPage: FC = () => (
  <Layout title="새 정책 문서" path="/policies/new">
    <PolicyForm />
    <div id="policy-list" />
  </Layout>
)

// ---------- 워크플로우 ----------

const Step: FC<PropsWithChildren<{ n: string; title: string; tools?: string[] }>> = ({ n, title, tools, children }) => (
  <>
    <div class="step">
      <div class="no">{n}</div>
      <div class="body">
        <strong>{title}</strong>
        <div>{children}</div>
        {tools ? <div class="tools">{tools.map((t) => <code>{t}</code>)}</div> : null}
      </div>
    </div>
    <div class="conn" />
  </>
)

export const WorkflowPage: FC<{ settings: Settings; lastRecordAt: string | null; todayCount: number }> = ({ settings, lastRecordAt, todayCount }) => (
  <Layout title="워크플로우" path="/workflow">
    <section class="box">
      <h2>매일 자정 자동 처리 흐름</h2>
      <div class="in">
        <p class="lead">Claude 클라우드 예약 작업이 매일 00:00(자정, 한국 시간)에 이 순서로 문의를 처리한다. 모든 단계는 이 서버의 MCP 도구로 이뤄진다.</p>
        <p>
          지금 상태: 읽기 전용 <span class="tag">{settings.readOnly ? '켜짐' : '꺼짐'}</span> 디버깅 모드{' '}
          <span class="tag">{settings.debugMode ? '켜짐' : '꺼짐'}</span> 자동 전송 <span class="tag">{settings.autoSendEnabled ? '허용' : '꺼짐'}</span>
        </p>
        <p>마지막 디버깅 기록 {lastRecordAt ?? '아직 없음'}, 오늘 기록 {todayCount}건. 오늘 00시 이후 기록이 0건이면 예약 작업이 돌지 않았거나 처리할 문의가 없었던 것이다.</p>
      </div>
    </section>

    <div class="cols">
      <div class="flow">
        <div class="trigger">매일 00:00 KST(자정). Claude 클라우드 예약 작업이 시작된다</div>
        <div class="conn" />

        <Step n="1" title="현황과 모드 확인" tools={['get_overview']}>
          읽기 전용, 디버깅, 자동 전송 상태와 유효 템플릿, 정책 문서 수를 본다.
          <div class="stop">읽기 전용이 켜져 있으면 미답변 문의 수만 세어 보고하고 여기서 끝낸다.</div>
        </Step>

        <Step n="2" title="지난 결과 점검" tools={['get_debug_summary', 'list_debug_records']}>
          최근 디버깅 기록에서 어느 유형이 몰렸는지, 한 번도 안 쓰인 정책이 있는지, 템플릿이나 정책 근거 없이 쓴 답변이 많은지 본다.
        </Step>

        <Step n="3" title="스스로 개선" tools={['update_template', 'save_template', 'update_policy_doc', 'save_policy_doc']}>
          부족한 가이드는 고치고 없는 유형은 새로 만든다. 정책 문서는 요약, 적용 상황, 태그, 구조만 정리한다. 의미는 바꾸지 않는다. 고칠 때마다 사유(editNote)를 적고 이전 내용은 이력에 남는다.
        </Step>

        <Step n="4" title="미답변 문의 읽기" tools={['list_pending_questions']}>
          답변이 없는 문의를 1페이지부터 읽는다. 이메일과 전화번호는 내려오지 않는다.
        </Step>

        <Step n="5" title="문의마다 정책과 템플릿 찾기" tools={['search_policy_docs', 'list_policy_docs', 'get_policy_doc', 'list_active_templates']}>
          정책이 걸린 문의(환불, 페이백, 일정, 가격)는 정책 전문을 읽는다. 맞는 템플릿 가이드를 고른다. 맞는 가이드가 없거나 애매하면 건드리지 않는다.
        </Step>

        <Step n="6" title="답변 작성">
          가이드를 그대로 복사하지 않고 그 문의의 상황과 말투에 맞춰 직접 쓴다. 확인하지 못한 환불, 환급 가능 여부는 단정하지 않는다.
        </Step>

        <Step n="7" title="기록 또는 전송" tools={['reply_question']}>
          참고한 템플릿 번호와 근거 정책 번호를 같이 넘긴다. 서버가 모드에 따라 처리한다.
          <div class="branch">
            <div>
              <div class="head">디버깅 모드 켜짐</div>
              유저에게 보내지 않는다. 문의, 템플릿, 근거 정책, 쓴 답변, 운영이었다면 결과를 기록만 한다.
            </div>
            <div>
              <div class="head">디버깅 꺼짐, 조건 통과</div>
              자동 전송 허용, 유효한 템플릿, 템플릿의 자동 전송 허용, 하루 상한 이내일 때만 실제로 보낸다.
            </div>
            <div>
              <div class="head">그 밖의 경우</div>
              초안으로 저장한다. 사람이 대시보드 기록에서 확인하고 보내거나 버린다.
            </div>
          </div>
        </Step>

        <Step n="8" title="보고">
          답변한 문의, 건너뛴 문의와 이유, 템플릿과 정책을 어떻게 고쳤는지를 짧게 보고한다.
        </Step>

        <div class="trigger">끝. 다음 실행은 내일 00:00</div>
      </div>

      <div>
        <section class="box">
          <h2>사람이 하는 일</h2>
          <div class="in">
            <p>설정: 읽기 전용, 디버깅 모드, 자동 전송 허용, 하루 상한, 답변 끝 문구. AI 는 바꿀 수 없다.</p>
            <p>템플릿의 자동 전송 허용: 대시보드 템플릿 목록에서만 켠다.</p>
            <p>정책 원문: 호정님과 경지님이 정한다. AI 가 정리한 내용은 수정 이력에서 되돌린다.</p>
            <p>정책 삭제: 사람만 한다.</p>
            <p>초안: 기록 메뉴에서 확인해 보내거나 버린다. 디버깅 모드가 켜져 있으면 보낼 수 없다.</p>
          </div>
        </section>
        <section class="box">
          <h2>매일 확인할 곳</h2>
          <div class="in">
            <p>디버깅 경과: 어제와 오늘 몇 건이 어느 유형이었는지, 운영이었다면 자동 전송과 초안 비율.</p>
            <p>디버깅 기록 목록: 문의와 쓴 답변을 읽고 어긋난 것을 찾는다.</p>
            <p>정책 문서: AI 가 고친 것이 있으면 마지막 수정이 AI 로 표시된다.</p>
          </div>
        </section>
        <section class="box">
          <h2>안전장치</h2>
          <div class="in">
            <p>이미 답변이 달린 문의와 이미 전송한 문의에는 쓰지 않는다.</p>
            <p>답변이 유저에게 나가는 통로는 하나이고, 디버깅 모드에서는 그 통로가 막힌다.</p>
            <p>MCP 에는 정책과 템플릿의 삭제 도구가 없고 정책 담당자와 원문 주소는 바꿀 수 없다.</p>
          </div>
        </section>
      </div>
    </div>
  </Layout>
)

export const WorkflowDocPage: FC<{ settings: Settings }> = ({ settings }) => (
  <Layout title="운영 문서" path="/workflow/doc">
    <section class="box">
      <h2>목적</h2>
      <div class="in">
        <p>챌린지 1:1 문의에 AI 가 운영정책과 답변 가이드를 근거로 답하게 하고, 그 과정을 기록해서 사람이 믿을 만한지 확인한 뒤에 자동 전송 범위를 넓힌다.</p>
        <p>지금은 {settings.debugMode ? '디버깅 모드가 켜져 있어 유저에게는 아무것도 나가지 않는다. 2주 정도 기록을 보며 판단한다.' : '디버깅 모드가 꺼져 있다. 조건을 통과한 답변은 유저에게 나갈 수 있다.'}</p>
      </div>
    </section>

    <section class="box">
      <h2>실행 일정</h2>
      <div class="in">
        <p>매일 00:00(자정, 한국 시간)에 Claude 클라우드 예약 작업이 실행된다. 작업 내용은 연결 메뉴의 예약 실행 프롬프트와 같다.</p>
        <p>예약 설정의 시간대가 한국 시간이 아니면 환산해서 맞춘다. 한국 00:00 은 UTC 로 전날 15:00 이다.</p>
        <p>예약 작업은 이 서버의 MCP 로만 문의를 읽고 쓴다. 인증 키는 Claude 클라우드 환경의 네트워크 시크릿에 넣어 두며 Claude 는 값을 보지 못한다.</p>
        <p>실행됐는지는 디버깅 경과의 날짜별 건수로 본다. 그날 00시 이후 기록이 없는 날은 실행되지 않았거나 처리할 문의가 없었던 날이다.</p>
      </div>
    </section>

    <section class="box">
      <h2>단계별 설명</h2>
      <div class="in">
        <p>1. 현황 확인: get_overview 로 모드와 현황을 읽는다. 읽기 전용이면 쓰기 도구가 보이지 않으므로 문의 수만 보고하고 끝난다.</p>
        <p>2. 지난 결과 점검: get_debug_summary 와 list_debug_records 로 어제까지의 기록을 본다. 정책 사용 현황에서 한 번도 안 쓰인 정책과 근거 없는 답변을 찾는다.</p>
        <p>3. 개선: 템플릿은 update_template, save_template 으로, 정책 문서는 update_policy_doc, save_policy_doc 으로 정리한다. 정책은 의미를 바꾸지 않고 editNote 에 이유를 적는다. 이전 내용은 정책 수정 이력에 남는다.</p>
        <p>4. 문의 읽기: list_pending_questions 로 미답변 문의를 읽는다. 페이지는 1부터 시작한다.</p>
        <p>5. 정책과 템플릿 찾기: 정책이 걸린 문의는 search_policy_docs 나 list_policy_docs 로 문서를 찾고 get_policy_doc 으로 전문을 읽는다. 조건과 예외가 본문 안에 있어 요약만 보고 답하지 않는다.</p>
        <p>6. 답변 작성: 가이드를 참고해 문의에 맞게 직접 쓴다.</p>
        <p>7. 기록 또는 전송: reply_question 에 templateId 와 policyIds 를 넣는다. 결과는 아래 모드별 규칙을 따른다.</p>
        <p>8. 보고: 처리한 문의, 건너뛴 문의와 이유, 고친 템플릿과 정책을 요약한다.</p>
      </div>
    </section>

    <section class="box">
      <h2>모드별 동작</h2>
      <div class="in">
        <p>읽기 전용 켜짐: 쓰기 도구가 사라진다. 읽기와 경과 조회만 된다.</p>
        <p>디버깅 모드 켜짐: 답변은 유저에게 가지 않고 기록만 된다. 이때 운영이었다면 자동 전송이었을지 초안이었을지도 함께 남는다. 전역 자동 전송이 꺼져 있어도 켜졌다고 가정해 판단한다.</p>
        <p>디버깅 모드 꺼짐: 자동 전송 허용, 유효한 템플릿, 템플릿의 자동 전송 허용, 하루 상한 이내를 모두 만족하는 답변만 전송된다. 나머지는 초안이다.</p>
      </div>
    </section>

    <section class="box">
      <h2>자동 전송으로 넘어가는 기준 (제안)</h2>
      <div class="in">
        <p>디버깅 경과에서 어떤 유형이 운영이었다면 자동 전송으로 집계되고, 기록 목록의 답변이 정책과 어긋나지 않는지 사람이 확인한다.</p>
        <p>어긋남이 없는 유형의 템플릿만 템플릿 목록에서 자동 전송을 허용한다. 환불, 환급처럼 판단이 필요한 유형은 초안으로 둔다.</p>
        <p>그다음 설정에서 디버깅 모드를 끄고 자동 전송을 허용한다. 처음에는 하루 상한을 작게 둔다.</p>
      </div>
    </section>

    <section class="box">
      <h2>문제가 생겼을 때</h2>
      <div class="in">
        <p>기록이 0건이다: 예약 작업이 실행되지 않았거나 키가 맞지 않다. 연결 메뉴에서 키와 주소를 확인한다.</p>
        <p>문의 목록이 비어 있다: 어드민 계정 권한이나 렛츠 API 주소를 환경 메뉴에서 확인한다.</p>
        <p>정책이 이상하게 바뀌었다: 정책 메뉴의 수정 이력에서 이전 내용으로 되돌린다.</p>
        <p>급히 멈춰야 한다: 설정에서 읽기 전용을 켠다. 다음 실행부터 쓰기가 막힌다.</p>
      </div>
    </section>
  </Layout>
)


// 문의가 들어온 시각과 기록한 시각, 그 사이 일수를 한 줄로 보여준다.
const lagText = (r: Reply) => {
  if (!r.questionCreatedAt) return null
  const d = daysBetween(r.questionCreatedAt, r.createdAt)
  return d <= 0 ? '접수한 날 기록' : `접수 ${d}일 뒤 기록`
}

export const BackfillButton: FC<{ show: boolean }> = ({ show }) =>
  show ? (
    <div class="actions">
      <button hx-post="/replies/backfill-dates" hx-target="#backfill-result" hx-swap="innerHTML">
        문의 접수일 채우기
      </button>
      <span id="backfill-result">접수일이 저장되기 전에 만든 기록에 렛츠 API 에서 접수일을 가져와 채운다. 한 번에 40건까지.</span>
    </div>
  ) : null

// ---------- 기록 ----------

const REPLY_LABEL: Record<Reply['status'], string> = { draft: '초안', simulated: '디버깅 기록', sent: '전송됨', failed: '실패', discarded: '버림' }

export const LogRow: FC<{ r: Reply; note?: string; canSend?: boolean }> = ({ r, note, canSend = true }) => (
  <tr id={`reply-${r.id}`}>
    <td>{REPLY_LABEL[r.status]}</td>
    <td>#{r.questionId}{r.userName ? ` ${r.userName}` : ''}</td>
    <td>{r.challengeId}</td>
    <td>
      {r.questionCreatedAt ?? '저장 전 기록'}
      {lagText(r) ? <p>{lagText(r)}</p> : null}
    </td>
    <td>
      <pre>{r.body}</pre>
      {r.error ? <p>오류: {r.error}</p> : null}
      {r.note ? <p>사유: {r.note}</p> : null}
      {note ? <p>{note}</p> : null}
    </td>
    <td>
      기록 {r.createdAt}
      {r.updatedAt !== r.createdAt ? <p>수정 {r.updatedAt}</p> : null}
    </td>
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

export const LogRows: FC<{ replies: Reply[]; canSend: boolean; next: string | null }> = ({ replies, canSend, next }) => (
  <>
    {replies.map((r) => <LogRow r={r} canSend={canSend} />)}
    {next ? <MoreRow href={next} cols={7} /> : null}
  </>
)

export const LogPage: FC<{
  replies: Reply[]
  total: number
  next: string | null
  canSend: boolean
  path: '/log' | '/log/drafts'
  anyMissingDate: boolean
}> = ({ replies, total, next, canSend, path, anyMissingDate }) => (
  <Layout title={path === '/log' ? '전체 기록' : '초안'} path={path}>
    <section class="box">
      <h2>{path === '/log' ? '전체 답변 기록' : '초안'}</h2>
      <div class="in">
        <BackfillButton show={anyMissingDate} />
        {total === 0 ? (
          <p>기록이 없다</p>
        ) : (
          <>
            <OrderNote total={total} shown={Math.min(total, replies.length)} />
            <table>
              <thead>
                <tr><th>상태</th><th>문의</th><th>챌린지</th><th>문의 접수</th><th>본문</th><th>기록 시각</th><th>작업</th></tr>
              </thead>
              <tbody>
                <LogRows replies={replies} canSend={canSend} next={next} />
              </tbody>
            </table>
          </>
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
