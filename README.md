# lets-cs-mcp

렛츠커리어 챌린지 1:1 문의를 Claude 가 읽고 답변할 수 있게 하는 MCP 서버와 관리 대시보드. Hono, Turso(libSQL), htmx 로 만들었다.

## 하는 일

- MCP 도구: `list_pending_questions`(page 는 1부터), `get_question`, `list_active_templates`, `list_templates`, `list_replies`, `reply_question`, `save_template`, `update_template`, `delete_template`. 읽기 전용이면 쓰기 도구는 보이지 않는다. MCP 로 만든 템플릿은 자동 전송이 꺼져 있고, 켜는 것은 대시보드에서 사람만 한다
- 대시보드: 답변 템플릿 관리(상황, 가이드, 유효기간), MCP 연결 정보와 키 복사, 읽기 전용 모드, 디버깅 모드와 경과 화면, 답변 기록
- 템플릿은 그대로 보내는 문구가 아니라 답변을 쓸 때 참고하는 가이드다. Claude 가 문의에 맞춰 직접 쓴다
- 템플릿은 기간을 두거나 계속 유효하게 둘 수 있고, 기간이 지난 템플릿은 MCP 가 내려주지 않는다
- 디버깅 모드가 켜져 있으면 MCP 와 대시보드 어디서도 유저에게 답변을 보내지 못한다. 대신 문의 내용, 참고한 템플릿, 쓴 답변, 운영이었다면 자동 전송이었을지 초안이었을지를 DB 에 남기고 디버깅 탭에서 기간별로 본다
- 처음에는 읽기 전용이고 디버깅 모드가 켜져 있다. 유저에게 실제로 나가려면 읽기 전용과 디버깅 모드를 끄고 자동 전송을 켜야 한다

## 환경 변수

`.env.example` 참고. `MCP_AUTH_TOKEN` 은 MCP 호출용 키이면서 대시보드 세션 서명에도 쓴다.

## 실행

```bash
pnpm install
pnpm dev        # http://localhost:8787, DB 는 local.db 파일
pnpm test
pnpm typecheck
```

## 배포

Vercel 에 올린다. 진입점은 깃에 있는 `api/index.js` 이고, 빌드(`pnpm build`)가 만드는 `dist/app.js` 번들을 불러온다. 함수는 빌드 전 파일 목록으로 찾기 때문에 진입 파일은 깃에 있어야 한다. 푸시하면 자동 배포된다. DB 는 Turso 를 쓰고 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 을 환경 변수로 넣는다.

## 호출 방식

`POST /mcp` 에 `Authorization: Bearer <MCP_AUTH_TOKEN>` 을 붙인다. Streamable HTTP 이고 세션을 들고 있지 않는다. 대시보드의 MCP 연결 박스에 Claude Code 용 명령과 `.mcp.json` 설정이 있다.
