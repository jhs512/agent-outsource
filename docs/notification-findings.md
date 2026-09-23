# 외부 이벤트로 현재 Codex 작업 재실행

검증일: 2026-09-23, Windows, Node.js 24.

## 결론

별도 Node.js 프로세스가 설치된 Codex 앱 도구 연결을 사용해 같은 작업으로 후속 메시지를 보내면, 이전 응답이 끝난 뒤에도 assistant 실행이 시작되는 것을 확인했다. 모델의 주기적 상태 조회는 사용하지 않았다.

## 실제 경로

외부 Node.js 타이머 → 설치된 codex-app-tools stdio MCP 서버 → 앱 로컬 파이프 → send_message_to_thread → 현재 작업 후속 메시지 → assistant 실행.

실험은 외부 프로그램의 이벤트 대신 20초 타이머를 사용했다. 작업자의 완료 또는 질문 이벤트를 같은 전송 지점에 연결할 수 있을 것으로 판단하지만, 실제 작업자 연동은 아직 시험하지 않았다.

## 증거

- 첫 실험: 앱 도구 목록 조회 성공, 후속 메시지 전송 성공, 현재 대화에 메시지 도착. 음성 종료 메시지와 근접했으므로 유휴 재실행의 단독 근거로 사용하지 않았다.
- 두 번째 실험: 음성 세션 종료 후 assistant 응답을 마쳤다. 별도 프로세스가 20초 뒤 전송했고, 다른 사용자 입력 없이 같은 대화에서 assistant 실행이 시작됐다.
- 로컬 기록에는 scheduled → sending → response가 있고 response.isError는 false다. 원본 기록은 프로젝트의 무시된 `.ai-oc/notification-probe.jsonl`에 있다.
- 별도 프로세스는 숨김 창으로 실행했고, 도구 호출을 살아 있게 유지하거나 모델로 로그를 반복 조회하지 않았다.

## 한계

- 공개적으로 보장된 외부 API가 아니라 설치된 앱 내부 도구 연결이다.
- 현재 작업에서 상속한 연결 환경과 대상 작업 정보가 필요하다. 독립적으로 실행하거나 앱을 재시작한 뒤에도 유지되는 서비스는 아직 아니다.
- 사용자 메시지처럼 표시되는 후속 메시지 방식이다. 일반 MCP notification이나 운영체제 알림과 다르다.
- 음성 통화 중 자동 발화와 개입 동작은 미검증이다.
- 완료 이벤트의 재전송/중복 방지, 인증 수명, 동시 실행 정책은 아직 구현하지 않았다.

## 공식 문서와의 구분

- [Background hooks](https://learn.chatgpt.com/docs/hooks#run-hooks-in-the-background): 훅이 끝나도 유휴 상태에서는 다음 사용자 턴까지 기다린다.
- [App Server](https://learn.chatgpt.com/docs/app-server): 연결된 app-server에는 턴 시작 기능이 있다. 현재 데스크톱의 제어 소켓 연결 실험은 실패했다. 별도의 app-server 실행을 현재 데스크톱 음성 대화 재개로 대체하지 않았다.

## 재현 파일

- `scripts/probe-app-tools.js`: 외부 프로세스의 앱 연결과 도구 조회.
- `scripts/notify-current-task.js`: 지연 후 현재 작업에 단발 메시지 전송.
- `scripts/probe-codex.js`: 공식 제어 소켓의 읽기 전용 연결 검사.
