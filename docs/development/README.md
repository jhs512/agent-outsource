# 공개 개발 기록

사용 방법은 [루트 README](../../README.md), 셋업은 [설치 안내](../setup.md)를 본다. 아래 문서는 설계·실험·검증 기록이며 과거 시점의 결과를 포함한다.

## 현재 구현

- [구현 계획](../local-skill-plan.md)
- [테스트 케이스](../local-skill-test-cases.md)
- [로컬 스킬 검증](../local-skill-verification.md)
- [필수 권한 우회 변경과 검증](../mandatory-bypass-verification.md)
- [공개 설치 흐름 검증](setup-verification.md)

현재 실행 코드는 `skills/agent-outsource/scripts/`, 셋업 코드는 `skills/agent-outsource-setup/scripts/`에 있다. Node.js 내장 기능만 사용한다.

```sh
npm test
```

기본 테스트는 실제 모델을 호출하지 않는다. `test/live-smoke.mjs`와 `test/agy-capabilities.mjs`는 실제 계정의 CLI를 호출하는 명시적 실험용 하네스다.

## 초기 실험 보존

- [이전 루트 README](initial-readme.md)
- [초기 외부 알림 실험](../notification-findings.md)
- `src/`: SQLite 전환 전 파일 저장 방식의 초기 초안
- `scripts/probe-*.js`, `scripts/notify-current-task.js`: 앱 내부 연결을 조사한 초기 실험

현재 완료 알림은 `codex queue`를 사용한다. 초기 앱 내부 파이프 실험을 현재 설치 절차로 사용하지 않는다. 옛 실험을 직접 재현하려면 필요한 의존성을 `npm install`로 준비한다.

원본 대화, 인증 정보, SQLite DB, 실행 로그는 공개 파일에 포함하지 않는다. 문서에 등장하는 증거 경로는 개발 환경에서 보관한 기록의 위치를 설명하며 해당 원본 파일은 공개하지 않는다.
