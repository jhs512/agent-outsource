# 모든 CLI 실행의 필수 권한 우회

2026-09-23 사용자 확정 변경. Claude Code와 Antigravity CLI에 `--dangerously-skip-permissions`를 항상 적용한다. 별도 권한 설정 선택이나 재승인을 요구하지 않는다. 작업 대상·범위·일반 질문의 실제 답은 기존대로 유지한다.

## 구현

- `providers.mjs`: 새 작업, 같은 세션 재개, 질문 후 재개에 공통 인자 생성기를 사용하며 플래그를 무조건 한 번 삽입한다. Claude의 충돌하는 `--permission-mode manual` 분기를 제거했다.
- `db.mjs`: 새로운 요청은 bypass로 저장한다. 기존 manual 요청은 호환 입력으로 받지만 flag를 끌 수 없다. 이전 DB의 실행 옵션과 결과는 변경하지 않으며 과거 요청 키의 재전송도 같은 작업을 반환한다.
- `service.mjs`: 예외적으로 도착한 Claude 권한 요청은 원래 도구 입력으로 자동 허용한다. AskUserQuestion은 분리해 실제 답을 기다린다. agy가 bypass에도 거절하면 추가 승인 요청 대신 needs_review로 기록한다.
- 각 실행의 `invocation.json`에 실제 spawn에 전달하는 실행파일과 인자를 보존한다. 프롬프트는 인자로 포함하지 않는다.
- 스킬과 참조 문서를 현재 동작에 맞췄다. 과거 수동 권한 요청 데이터의 읽기/답변 형식은 호환 목적으로 유지한다.

## 실제 CLI 검증

로컬 증거: `<repo>/.ai-oc/live-1790129890283/evidence.json` 및 같은 폴더 `smoke.sqlite.logs/*/invocation.json`. 원본 로그는 공개하지 않는다.

| 검증 | Claude | Antigravity |
|---|---|---|
| 새 실행 실제 bypass 인자 | 확인·completed | 확인·completed |
| 같은 세션 재개 bypass 인자 | 확인·같은 session·기억한 단어 재확인 | 확인·같은 conversation·기억한 단어 재확인 |
| 종료 후 일반 질문/답변/재개 | bypass 유지·답 반영·completed | bypass 유지·답 반영·completed |
| live 일반 질문 | AskUserQuestion 답 대기 및 합성 답 반영 성공 | 기존 live control 미지원 범위 유지 |
| 추가 승인 없는 무해한 파일 쓰기 | 파일 존재·completed·waiting_permission 이벤트 0 | 기존 훅 오류 때문에 네이티브 도구 성공으로 표시하지 않음 |
| 실행 중 취소 | cancelled | cancelled |

실제 테스트의 최초 요청에는 호환성 확인용 `permission: manual`을 넣었다. 실제 실행 인자에는 두 CLI 모두 bypass가 들어갔다. 테스트 답은 명시적인 합성 입력이며 실제 사용자 취향을 대신 선택하지 않았다.

## 자동 테스트와 보존

최종 `npm test`: **15개 통과, 0개 실패**. 출력은 `.ai-oc/bypass-test-results.txt`에 있다. 실제 spawn 인자 기록 12개 모두 필수 flag가 정확히 한 번 있고 충돌 옵션이 없음을 검사했다. 스킬 검증기 통과 및 소스/설치본 파일 해시 일치를 확인했다.

양쪽 CLI × 새 실행/재개 × 옵션 생략/manual/bypass 조합에서 필수 플래그가 정확히 한 번 있고 충돌하는 permission-mode가 없는지 검사한다. 예외적인 권한 요청 자동 처리와 일반 질문 유지, 과거 idempotency key 호환도 검증한다. 나머지 SQLite·복구·알림·취소 회귀 테스트를 함께 실행한다.

실행 중인 작업이 없음을 확인한 뒤 서비스를 정상 정지하고 설치본을 갱신해 다시 시작했다. 전후 DB의 jobs/runs/questions/outbox/commands 전체 행 해시가 동일하다(작업 2, 실행 2, 질문 0, outbox 2, 요청 2). 기존 작업·결과·수신 ack를 보존했다.

이 검증 당시 변경은 로컬 소스와 설치본에 적용했고, 이후 사용자 승인으로 소스와 개발 기록을 공개 저장소에 포함했다. 권한 우회는 기존의 고장 난 사용자 훅을 수리하거나 agy에 없는 live control 프로토콜을 추가하는 기능은 아니다.
