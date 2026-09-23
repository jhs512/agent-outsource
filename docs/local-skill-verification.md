# 로컬 스킬 구현 및 검증

검증일: 2026-09-23. Node.js 24.13.1, Claude Code 2.1.280, Antigravity CLI 1.2.8, Windows.

**현재 동작 변경:** 사용자 추가 요청에 따라 두 CLI는 모든 실행·재개에서 `--dangerously-skip-permissions`를 항상 사용한다. 아래 수동 허용/거절 기록은 변경 전 검증 이력이다. 현재 인자·일반 질문 유지·자동 파일 쓰기 검증은 [필수 bypass 검증](mandatory-bypass-verification.md)에 기록했다.

## 구현 위치

- 계획: `docs/local-skill-plan.md`
- 테스트 케이스: `docs/local-skill-test-cases.md`
- 저장소 소스: `skills/agent-outsource/`
- 로컬 설치: `$CODEX_HOME/skills/agent-outsource/SKILL.md` (기본 `~/.codex/skills/`)
- 공유 DB: `~/ai-oc.sqlite`
- 원본 로그: `~/ai-oc.sqlite.logs/`

스킬은 작업자 선택이나 배정 시점을 결정하지 않는다. 호출자가 지정한 작업·제공자·경로·대상 대화를 전달하고 실행/응답/복구/알림을 관리한다. 이 검증 당시에는 로컬에서만 작업했으며, 이후 사용자 승인으로 소스와 개발 기록을 공개 저장소에 포함했다. 기존 초안 파일은 보존했다.

## 실제 CLI 검증

| 항목 | Claude | Antigravity |
|---|---|---|
| 작업 전달·결과 저장 | 성공 | 성공 |
| 정확한 세션 ID로 후속 질문 | 성공; 이전 단어 plum 기억 확인 | 성공; 이전 단어 plum 기억 확인 |
| 종료 후 질문 → 답 → 같은 세션 재개 | 성공 | 성공 |
| 살아 있는 질문 도구에 답변 | AskUserQuestion 성공 | control response 입력 미지원 실증 |
| 살아 있는 권한 요청 허용 | Write 허용 후 파일 존재 확인 | 미지원; 사전 bypass 실험도 기존 훅 오류로 실행 실패 |
| 살아 있는 권한 요청 거절 | Write 거절 후 파일 미생성 확인 | 미지원; 기본 권한 정책 실험도 기존 훅 오류로 실패 |
| 실행 중 취소 | cancelled 확인 | cancelled 확인 |
| 홈 DB + 실제 완료 알림 | completed, 조율 대화 턴 종료 후 실제 수신·재실행 확인, outbox acked | completed, 조율 대화에 새 입력으로 실제 수신·재실행 확인, outbox acked |

질문·권한 테스트의 응답은 테스트 하네스에 명시한 합성 입력이다. 실제 프로젝트의 사용자 결정을 대신한 것이 아니다. 두 CLI의 동시 실행 작업은 각자의 작업·세션·대상으로 분리됐다. 마지막 두 작업은 원래 조율 대화 ID를 입력 JSON에서 받아 전송했으며 코드에 영구 하드코딩하지 않았다.

Claude 완료 이벤트는 조율 대화가 턴을 종료한 뒤 실제 입력으로 전달돼 해당 대화가 재실행됐다는 수신측 회신을 받았다. 이벤트 `9c3c8ab3-6e2f-49d3-aeeb-75a678cbff3a`를 DB에서 acked 처리했다. 작업 `1f69fdd3-8666-413c-8bbb-49ed5672553e`, 실행 `56d195ce-06cc-4c64-8373-406d94a0b555`와 일치한다. 새 작업을 재실행하지 않았다.

Antigravity 완료 이벤트도 조율 대화의 새 입력으로 실제 수신됐다는 회신을 받았다. 이벤트 `7faca10e-efe1-46c6-8d15-9559aae40464`를 DB에서 acked 처리했다. 작업 `0596bf08-47ae-4e3c-b27c-4b43ba7dcb7a`, 실행 `4148d05e-e1a8-42c0-a1dd-a4d63c329cf2`와 일치한다. Claude의 기존 ack도 멱등하게 재확인했다. 두 CLI 작업을 다시 실행하거나 알림을 재전송하지 않았다.

따라서 두 제공자의 실제 작업 완료 → 영구 outbox → codex queue → 원래 Codex 대화의 새 입력 및 재실행 → 수신 ack까지 확인했다. 이는 queue 종료 코드만을 근거로 한 판정이 아니다. **음성 발화는 별도 미검증**이며 이번 검증이 사용자가 실제로 들었음을 보장하지는 않는다.

## 실증 중 발견한 환경 제한

Antigravity의 네이티브 도구 호출에서 다음 연결이 관찰됐다: 기존 `orca-status` PreToolUse 훅의 경로 오류 → 비UTF8 오류 출력 → 제공자 invalid UTF-8 실패. 사용자 전역 훅/권한 설정은 수정하지 않았다.

`--json-schema` 경로도 같은 오류를 만났으므로 agy 어댑터는 프롬프트로 JSON을 요청하고 결과를 엄격히 검사한다. 이 조정 후 무도구 결과·세션 재개·질문 답변은 통과했다. 네이티브 도구 사용 문제까지 해결된 것은 아니다.

Antigravity의 `control_response` 메시지는 실제 CLI가 미지원이라고 응답하며 종료 코드 2로 끝났다. 이를 live 승인 기능으로 구현하지 않았다. 종료된 질문은 같은 conversation으로 재개하고, 감지된 권한 거절은 별도 승인 필요 상태로 전달한다. 그 상태에서 `allow`를 보내면 지원되지 않는다고 거절하며 광범위한 권한 생략으로 조용히 바꾸지 않는다.

## 자동 검증

최종 `npm test`: **13개 통과, 0개 실패**. 통합 테스트 한 개 안에서 두 제공자·질문·권한·취소·복구·정상 서비스 종료를 순차 검증한다. 전체 출력은 `.ai-oc/final-test-results.txt`에 보존했다. 스킬 검증기 통과, 설치본 8개 파일의 소스 해시 일치, 모든 실행 파일 구문 검사도 완료했다.

`npm test`는 실제 유료 모델을 부르지 않는 테스트만 실행한다. 테스트 DB와 로그는 임시 디렉터리로 격리한다. 실제 CLI 하네스는 명시적으로 `node test/live-smoke.mjs` 또는 `node test/agy-capabilities.mjs`를 실행해야 한다.

검증 내용:

- 네 개 Node 프로세스가 같은 SQLite에 동시 기록: WAL, 유일 키, 작업 중복 방지.
- 같은 요청의 재전송 및 충돌, 다른 caller의 조회/답변 거부.
- live 질문/승인, 종료 후 세션 재개, 중복 답변 및 stale 답변 처리.
- 결과 저장과 outbox 생성의 원자성; 실패한 알림 재시도 중 결과 보존.
- 전송 후 기록 전 장애의 불확실성과 동일 event ID 중복 전달, 멱등 ack.
- 감독 프로세스 이중 시작 방지, 강제 종료 후 알려진 고아 작업자 정리 및 interrupted 보존.
- PID 재사용 시 다른 프로세스를 종료하지 않음; 정리 실패 시 recovery_blocked로 새 실행 차단.
- 실행파일 없음·비정상 종료·결과 없는 정상 종료를 구분.
- 20초 무출력 유지 후 취소: 무출력을 실패로 해석하지 않음. 모델 반복 폴링 없이 일반 프로그램이 대기.
- 초대형 출력의 원본 로그 보존과 파서 메모리 상한.
- 취소/완료 경합 및 단일 종료 결과, 정확한 대상 대화 라우팅.

## 보존된 실제 증거

원본 로그는 Git에서 제외된 로컬 경로에 있다.

- `.ai-oc/live-1790128786411/evidence.json`: Claude 전체 실증과 첫 agy 오류.
- `.ai-oc/live-1790128934502/evidence.json`: 수정 후 agy 결과·세션·질문·취소 성공.
- `.ai-oc/agy-capabilities-1790128983408/evidence.json`: agy control 입력 미지원 및 네이티브 도구의 기존 훅 오류.
- `~/ai-oc.sqlite`: 최종 두 실제 작업 결과, 원래 caller, outbox 전송 기록.

## 남은 제약

- 앱이 완전히 종료됐을 때 알림이 최종 수신되는지는 미검증. 실패한 queue 호출은 지수 백오프로 재시도한다. 성공 반환 후 수신 여부는 ack로 구분하고, 필요 시 같은 이벤트를 수동 재전송한다.
- 명령 수락과 음성 발화는 다르다. 사용자가 실제로 들었는지는 자동 보장하지 않는다.
- 프로세스 spawn 직후 PID를 저장하기 전의 짧은 장애 구간은 interrupted로 보존하고 자동 재실행하지 않는다. 사람이 부작용을 확인한 뒤 후속 실행해야 한다.
- live stdin 답변을 쓰던 중 장애가 나면 전달 여부가 불확실할 수 있다. 무조건 답을 재전송하지 않고 중단으로 보존한다.
- 배경 서비스는 로컬 명령으로 시작/복구하며 운영체제 자동 시작 서비스 등록은 하지 않았다.
- SQLite를 포함한 로컬 사용자 파일은 운영체제 계정 권한을 따른다. 다른 OS/CLI 버전은 실증하지 않았다.

## 공식 근거

- [Claude programmatic usage](https://code.claude.com/docs/en/headless)
- [Antigravity headless stream input and unsupported control messages](https://antigravity.google/docs/cli/headless/)
- [Antigravity hooks](https://antigravity.google/docs/hooks?tab=cli)

공식 설명보다 현재 설치본의 실제 성공/실패 기록을 우선하여 지원 범위를 표시했다.
