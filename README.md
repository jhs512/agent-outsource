# ai-oc

Codex 데스크톱 음성 대화를 유지하면서 Claude Code와 Antigravity CLI 작업을 관리하는 Node.js 실험 프로젝트.

## 현재 우선순위

**외부 프로세스의 이벤트로 현재 Codex 대화가 다시 실행되는지 먼저 증명한다.**

- GitHub 공개 저장소와 로컬 Git 연결 완료.
- Node.js 24 기반 작업자 관리 초안 작성. 아직 실제 작업자 통합 테스트 전이다.
- 공식 app-server 제어 소켓에 연결하는 실험은 현재 Windows 환경에서 실패했다.
- 설치된 `codex-app-tools` MCP 서버를 별도 Node.js 프로세스에서 실행해 앱 연결 및 `send_message_to_thread` 도구 조회에 성공했다.
- 이 앱 내부 연결은 공개 외부 API로 문서화된 계약이 아니다. 앱 업데이트에 따라 변경될 수 있다.
- **대기 중인 현재 턴을 깨우는지와 음성 전달 여부는 별도 실험으로 확인해야 한다.**

## 알림 실험

```powershell
npm install
node scripts/probe-codex.js
node scripts/probe-app-tools.js
node scripts/notify-current-task.js 20000
```

마지막 명령은 현재 Codex 작업에서 상속한 앱 연결 환경을 사용해 20초 뒤 같은 작업으로 테스트 메시지를 한 번 보낸다. 독립 실행하려면 대상 작업과 연결 수명의 설계가 추가로 필요하다. 실행 기록은 Git에서 제외된 `.ai-oc/notification-probe.jsonl`에 저장한다. 비밀값, 원본 대화, 실행 로그는 저장소에 올리지 않는다.

## 작업자 초안

`src/`에는 분리된 Node.js 프로세스로 CLI를 실행하고 원본 로그를 로컬에 저장하는 초안이 있다. `queued`, `running`, `waiting_user`, `completed`, `failed`, `cancelled`, `needs_review`를 구분한다. 종료 코드만으로 완료 처리하지 않고 구조화된 결과를 요구한다. 질문에 대한 실제 사용자 답과 질문 식별자로 같은 제공자 세션을 재개하도록 설계했다. 아직 MCP 작업자 도구 및 운영 설치는 완료되지 않았다.

## 확인한 공식 자료

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): 연결된 서버에서 턴 시작을 지원한다. 이것만으로 기존 데스크톱 음성 대화 연결을 증명하지는 않는다.
- [Background hooks](https://learn.chatgpt.com/docs/hooks#run-hooks-in-the-background): 활성 턴이 없으면 다음 사용자 턴을 기다린다. 훅 완료 자체가 새 턴을 시작하지 않는다.

프로토타입이며, 실제 검증 결과와 미검증 부분을 구분해 기록한다.
