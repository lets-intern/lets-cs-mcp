# lets-cs-mcp

렛츠커리어 챌린지 1:1 문의를 Claude 가 읽고 답변할 수 있게 하는 MCP 서버와 관리 대시보드. Hono, Turso(libSQL), htmx 로 만들었다.

## 하는 일

- MCP 도구: `list_pending_questions`, `get_question`, `list_active_templates`, `list_replies`, `reply_question`
- 대시보드: 답변 템플릿 관리(상황, 본문, 유효기간), MCP 연결 정보와 키 복사, 읽기 전용 모드, 가상 전송 모드, 답변 기록
- 템플릿은 기간을 두거나 계속 유효하게 둘 수 있고, 기간이 지난 템플릿은 MCP 가 내려주지 않는다
- 처음에는 읽기 전용이고 가상 전송이 켜져 있다. 고객에게 실제로 나가려면 둘 다 끄고 자동 전송을 켜야 한다

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

Vercel 에 올린다. `src/index.ts` 가 진입점이다. DB 는 Turso 를 쓰고 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 을 환경 변수로 넣는다.

## 호출 방식

`POST /mcp` 에 `Authorization: Bearer <MCP_AUTH_TOKEN>` 을 붙인다. Streamable HTTP 이고 세션을 들고 있지 않는다. 대시보드의 MCP 연결 박스에 Claude Code 용 명령과 `.mcp.json` 설정이 있다.
