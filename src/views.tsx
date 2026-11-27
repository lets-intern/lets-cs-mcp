import type { FC, PropsWithChildren } from 'hono/jsx'
import { templateStatus, type Reply, type Settings, type Template, type TemplateStatus } from './store.js'

// 검정과 흰색만 쓴다. 모서리는 각지게, 구분은 테두리로만 한다.
const css = `
*{box-sizing:border-box;border-radius:0}
body{margin:0;font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#000;background:#fff}
main{max-width:960px;margin:0 auto;padding:16px}
nav{display:flex;border:2px solid #000}
nav a,nav button{padding:8px 16px;color:#000;text-decoration:none;border:0;border-right:2px solid #000;background:#fff;font:inherit;cursor:pointer}
nav a.on,nav a:hover,nav button:hover{background:#000;color:#fff}
nav form{margin:0 0 0 auto;display:flex}
nav form button{border-right:0;border-left:2px solid #000}
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

type Tab = 'home' | 'templates' | 'log'

export const Layout: FC<PropsWithChildren<{ title: string; active?: Tab }>> = ({ title, active, children }) => (
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
        {active ? (
          <nav>
            <a href="/" class={active === 'home' ? 'on' : ''}>대시보드</a>
            <a href="/templates" class={active === 'templates' ? 'on' : ''}>템플릿</a>
            <a href="/log" class={active === 'log' ? 'on' : ''}>기록</a>
            <form method="post" action="/logout"><button type="submit">로그아웃</button></form>
          </nav>
        ) : null}
        {children}
      </main>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </body>
  </html>
)

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

export const DryRunBox: FC<{ dryRun: boolean }> = ({ dryRun }) => (
  <section class="box" id="dry-box">
    <h2>
      가상 전송 모드 <span class="tag">{dryRun ? '켜짐' : '꺼짐'}</span>
    </h2>
    <div class="in">
      <p>
        {dryRun
          ? '자동 전송 조건을 모두 통과해도 실제로는 보내지 않는다. 대신 "이 문구가 나갔을 것이다" 를 기록 화면에 가상 전송으로 남긴다. 기록을 보고 괜찮으면 거기서 실제 전송하거나, 이 모드를 끈다.'
          : '꺼져 있다. 자동 전송 조건을 통과한 답변은 실제로 고객에게 나간다.'}
      </p>
      <div class="actions">
        <button
          class={dryRun ? 'on' : ''}
          hx-post="/settings/dry-run"
          hx-vals={JSON.stringify({ value: dryRun ? '0' : '1' })}
          hx-target="#dry-box"
          hx-swap="outerHTML"
          hx-confirm={dryRun ? '가상 전송을 끈다. 이후 자동 전송은 실제로 나간다. 계속할까?' : undefined}
        >
          {dryRun ? '가상 전송 끄기 (실제로 전송)' : '가상 전송 켜기'}
        </button>
      </div>
    </div>
  </section>
)

export const Stats: FC<{ activeTemplates: number; drafts: number; sentToday: number; simulatedToday: number; maxSendPerDay: number }> = (p) => (
  <div class="stats">
    <div class="box"><h2>유효 템플릿</h2><div class="in"><strong>{p.activeTemplates}</strong></div></div>
    <div class="box"><h2>대기 중 초안</h2><div class="in"><strong>{p.drafts}</strong></div></div>
    <div class="box"><h2>오늘 전송</h2><div class="in"><strong>{p.sentToday} / {p.maxSendPerDay}</strong></div></div>
    <div class="box"><h2>오늘 가상 전송</h2><div class="in"><strong>{p.simulatedToday}</strong></div></div>
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
  '1. list_active_templates 로 오늘 유효한 템플릿을 읽는다. readOnly 가 true 면 미답변 문의 수만 세어 보고하고 끝낸다.',
  '2. list_pending_questions 로 미답변 문의를 읽는다.',
  '3. 문의에 맞는 템플릿이 분명히 하나일 때만, 본문의 {{변수}} 를 문의 값(userName, challengeTitle 등)으로 모두 치환해 reply_question 을 부른다. 템플릿의 autoSend 가 true 면 mode 를 send, 아니면 draft 로 한다. templateId 를 항상 넣는다.',
  '4. 맞는 템플릿이 없거나 애매하면 건드리지 않는다.',
  '5. 마지막에 처리한 문의, 건너뛴 문의와 그 이유를 짧게 보고한다.',
].join('\n')

export const ConnectBox: FC<{ origin: string; token: string }> = ({ origin, token }) => {
  const url = `${origin}/mcp`
  const cli = (k: string) => `claude mcp add --transport http lets-cs ${url} --header "Authorization: Bearer ${k}"`
  const json = (k: string) =>
    JSON.stringify({ mcpServers: { 'lets-cs': { type: 'http', url, headers: { Authorization: `Bearer ${k}` } } } }, null, 2)
  return (
    <section class="box" id="connect-box">
      <h2>MCP 연결</h2>
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
        <div class="muted" />
        <Copyable label="Claude Code 에 추가" shown={cli(mask(token))} text={cli(token)} />
        <Copyable label=".mcp.json 설정" shown={json(mask(token))} text={json(token)} />
        <Copyable label="클라우드 예약 실행 프롬프트" shown={SCHEDULE_PROMPT} text={SCHEDULE_PROMPT} />
      </div>
    </section>
  )
}

export const SettingsBox: FC<{ settings: Settings; saved?: boolean }> = ({ settings, saved }) => (
  <section class="box" id="settings-box">
    <h2>설정</h2>
    <form class="in" hx-post="/settings" hx-target="#settings-box" hx-swap="outerHTML">
      <label class="inline">
        <input type="checkbox" name="autoSendEnabled" checked={settings.autoSendEnabled} />
        자동 전송 허용 (끄면 mode=send 도 모두 초안으로 저장된다. 켜도 가상 전송이 켜져 있으면 실제로는 보내지 않는다)
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

export const InfoBox: FC<{ apiBase: string; dbKind: string }> = ({ apiBase, dbKind }) => (
  <section class="box">
    <h2>환경</h2>
    <div class="in">
      <p>렛츠 API: {apiBase}</p>
      <p>저장소: {dbKind}</p>
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
        <div id={`preview-${t.id}`} />
        <div class="actions">
          <button hx-get={`/templates/${t.id}/preview`} hx-target={`#preview-${t.id}`} hx-swap="innerHTML">미리보기</button>
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

export const TemplatePreview: FC<{ text: string; sample: Record<string, string> }> = ({ text, sample }) => (
  <div class="muted">
    <p>
      미리보기 (샘플 값 {Object.entries(sample).map(([k, v]) => `${k}=${v}`).join(', ')}, 답변 끝 문구 포함). 저장되지 않는다.
    </p>
    <pre>{text}</pre>
  </div>
)

export const TemplateForm: FC<{ t?: Template }> = ({ t }) => {
  const attrs = t
    ? { 'hx-put': `/templates/${t.id}`, 'hx-target': `#tpl-${t.id}`, 'hx-swap': 'outerHTML' }
    : { 'hx-post': '/templates', 'hx-target': '#tpl-list', 'hx-swap': 'afterbegin', 'hx-on::after-request': 'if(event.detail.successful)this.reset()' }
  return (
    <form class="box" id={t ? `tpl-${t.id}` : 'tpl-new'} {...attrs}>
      <h2>{t ? '템플릿 수정' : '새 템플릿'}</h2>
      <div class="in">
        <label>제목 (상황 이름)</label>
        <input name="title" required value={t?.title ?? ''} />
        <label>이 답변을 쓸 상황 (Claude 가 이 설명을 보고 고른다)</label>
        <textarea name="situation" rows={2} required>{t?.situation ?? ''}</textarea>
        <label>답변 본문. 변수는 {'{{userName}}'}, {'{{challengeTitle}}'} 처럼 쓴다</label>
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
  <Layout title="템플릿" active="templates">
    <TemplateForm />
    <div id="tpl-list">
      {templates.map((t) => <TemplateItem t={t} today={today} />)}
    </div>
  </Layout>
)

// ---------- 기록 ----------

const REPLY_LABEL: Record<Reply['status'], string> = { draft: '초안', simulated: '가상 전송', sent: '전송됨', failed: '실패', discarded: '버림' }

export const LogRow: FC<{ r: Reply; note?: string }> = ({ r, note }) => (
  <tr id={`reply-${r.id}`}>
    <td>{REPLY_LABEL[r.status]}</td>
    <td>#{r.questionId}{r.userName ? ` ${r.userName}` : ''}</td>
    <td>{r.challengeId}</td>
    <td>
      <pre>{r.body}</pre>
      {r.error ? <p>오류: {r.error}</p> : null}
      {r.status === 'simulated' ? <p>실제로는 보내지 않았다. 보냈다면 위 문구가 나갔을 것이다.</p> : null}
      {r.note ? <p>사유: {r.note}</p> : null}
      {note ? <p>{note}</p> : null}
    </td>
    <td>{r.updatedAt}</td>
    <td>
      {r.status === 'draft' || r.status === 'simulated' ? (
        <div class="actions">
          <button hx-post={`/replies/${r.id}/send`} hx-target={`#reply-${r.id}`} hx-swap="outerHTML" hx-confirm="고객에게 이 답변을 실제로 보낸다. 계속할까?">{r.status === 'simulated' ? '실제 전송' : '전송'}</button>
          <button hx-post={`/replies/${r.id}/discard`} hx-target={`#reply-${r.id}`} hx-swap="outerHTML">버리기</button>
        </div>
      ) : null}
    </td>
  </tr>
)

export const LogPage: FC<{ replies: Reply[] }> = ({ replies }) => (
  <Layout title="기록" active="log">
    <section class="box">
      <h2>답변 기록</h2>
      <div class="in">
        {replies.length === 0 ? (
          <p>기록이 없다</p>
        ) : (
          <table>
            <thead>
              <tr><th>상태</th><th>문의</th><th>챌린지</th><th>본문</th><th>시각</th><th>작업</th></tr>
            </thead>
            <tbody>{replies.map((r) => <LogRow r={r} />)}</tbody>
          </table>
        )}
      </div>
    </section>
  </Layout>
)

export const HomePage: FC<{
  stats: { activeTemplates: number; drafts: number; sentToday: number; simulatedToday: number; maxSendPerDay: number }
  settings: Settings
  origin: string
  token: string
  apiBase: string
  dbKind: string
}> = ({ stats, settings, origin, token, apiBase, dbKind }) => (
  <Layout title="대시보드" active="home">
    <ReadOnlyBox readOnly={settings.readOnly} />
    <DryRunBox dryRun={settings.dryRun} />
    <Stats {...stats} />
    <ConnectBox origin={origin} token={token} />
    <SettingsBox settings={settings} />
    <InfoBox apiBase={apiBase} dbKind={dbKind} />
  </Layout>
)
