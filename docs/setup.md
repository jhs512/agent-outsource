# 설치와 셋업

## Codex에서 설치

README의 자연어 설치 요청은 Codex의 skill-installer로 GitHub 저장소 안의 두 스킬 폴더를 설치하는 방식이다.

| 폴더 | 역할 |
|---|---|
| `skills/cli-worker-bridge` | 작업 실행, 질문·답변 전달, 같은 세션 재개, 완료 알림 |
| `skills/cli-worker-bridge-setup` | 설치와 실행 준비 검사 |

설치 위치는 `$CODEX_HOME/skills`이며, 별도 설정이 없으면 사용자 홈의 `.codex/skills`이다. 두 폴더를 나란히 설치한다. 사용자명이나 개발 PC 경로를 입력할 필요는 없다. 이미 설치된 폴더가 있으면 기존 변경을 확인한 뒤 업데이트한다.

## 셋업이 확인하는 것

`$cli-worker-bridge-setup`은 포함된 `scripts/setup.mjs`를 실행한다.

- Node.js 24 이상과 지원 OS
- 작업 스킬이 함께 설치됐는지
- 홈의 `ai-oc.sqlite` 준비, WAL 모드와 무결성 검사
- `codex queue --help`의 대상 대화·메시지 옵션
- 설치된 작업자 CLI의 버전과 필수 실행 옵션
- Claude의 읽기 전용 로그인 상태

검사는 AI 모델을 호출하지 않고 알림도 보내지 않는다. 홈 DB와 필요한 테이블은 만들지만 기존 작업·결과를 지우지 않는다. `ok`는 검사 통과, `missing`은 필요한 조치, `optional`은 사용하려면 준비할 작업자, `manual`은 직접 확인할 항목이다.

## 로그인

- Claude: 터미널에서 `claude auth login`을 실행하고 표시되는 로그인 절차를 따른다.
- Antigravity: 터미널에서 `agy`를 열고 로그인한다. 셋업은 agy의 로그인 완료를 자동 판정하지 않는다.
- Codex: Codex 앱의 로그인과 실행 중인 대화를 사용한다. 셋업이 queue 도움말을 확인해도 실제 알림 수신까지 검사한 것은 아니다.

비밀번호나 인증 토큰을 Codex 대화에 붙여 넣을 필요가 없다. 로그인 후 셋업을 다시 요청하거나 README의 작은 첫 작업으로 사용을 시작한다.

## 실행파일을 찾지 못할 때

CLI를 설치한 뒤 Codex를 다시 열어 새 PATH가 적용되게 한다. 프로그램은 PATH와 일반적인 사용자 설치 위치를 확인한다. Windows에서는 네이티브 `.exe`를 사용한다. 직접 경로를 지정해야 한다면 `AI_OC_CLAUDE`, `AI_OC_AGY`, `AI_OC_CODEX` 환경변수에 해당 실행파일 경로를 설정하고 Codex를 다시 연다. 명령 문자열이나 인증 토큰을 넣는 설정이 아니다.

`codex queue`가 없으면 해당 명령을 지원하는 Codex CLI가 필요하다. 셋업은 Codex를 자동 업데이트하거나 앱 설정을 바꾸지 않는다.

## 직접 셋업 실행

Codex 스킬 호출 대신 터미널을 사용하고 싶다면 설치된 `cli-worker-bridge-setup` 폴더에서 실행한다.

```sh
node scripts/setup.mjs
```

JSON 결과는 `node scripts/setup.mjs --json`으로 받을 수 있다. 저장소를 직접 내려받았다면 저장소 루트에서 `npm run setup`을 실행해도 된다. 둘 다 추가 npm 의존성 없이 실행된다.

작업 실행은 `$cli-worker-bridge`에 요청한다. 모든 실행의 권한은 자동 승인되며, 사용자 선택이 필요한 일반 질문에는 답을 기다린다.
