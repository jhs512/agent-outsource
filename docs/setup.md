# 설치와 셋업

## Codex에서 설치

README의 `npx --yes skills@latest add ...` 명령으로 GitHub 저장소의 두 스킬을 설치한다. `--agent codex`는 Codex에, `--agent codex claude-code`는 두 에이전트에 스킬 파일을 복사한다. 현재 조정 호스트는 Codex이며 결과 수신에는 `codex queue`가 필요하다.

| 폴더 | 역할 |
|---|---|
| `skills/agent-outsource` | 작업 실행, 질문·답변 전달, 같은 세션 재개, 완료 알림 |
| `skills/agent-outsource-setup` | 설치와 실행 준비 검사 |

`--global --copy`는 선택한 에이전트의 사용자 단위 스킬 위치에 파일을 복사한다. 설치 결과에 표시되는 경로를 확인한다. 두 스킬 폴더를 나란히 설치하며 사용자명이나 개발 PC 경로를 입력할 필요는 없다. 이미 설치된 폴더가 있으면 기존 변경을 확인한 뒤 업데이트한다.

## 셋업이 확인하는 것

`$agent-outsource-setup`은 먼저 사용자 Codex 설정에서 전용 데이터 폴더의 쓰기 허용 여부를 확인하고, 누락됐으면 기존 설정을 보존하며 추가한다. 그다음 포함된 `scripts/setup.mjs`를 실행한다. 검사만 요청한 경우 설정을 변경하지 않는다.

셋업은 사용자 명시 호출 전용이며, 작업 스킬은 요청에 맞으면 자동 선택할 수 있다. Codex에서는 각 스킬의 `agents/openai.yaml`에 `policy.allow_implicit_invocation`을 셋업 `false`, 작업 `true`로 설정한다. Claude Code용 `SKILL.md`의 `disable-model-invocation`은 셋업 `true`, 작업 `false`다. Codex에서는 `$agent-outsource-setup`으로 명시 호출한다. Claude Code의 명시 호출 문법은 `/agent-outsource-setup`이며, 파일 설치만으로 Codex 조정 호스트 의존성이 사라지지는 않는다. 이 설정은 아래 검사 프로그램의 모델 호출 여부와 별개다. 근거: [Codex 공식 문서](https://learn.chatgpt.com/docs/build-skills), [Claude Code 공식 문서](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill).

- Node.js 24 이상과 지원 OS
- 작업 스킬이 함께 설치됐는지
- 전용 디렉터리의 `agent-outsource.sqlite` 준비, WAL 모드와 무결성 검사
- `codex queue --help`의 대상 대화·메시지 옵션
- 설치된 작업자 CLI의 버전과 필수 실행 옵션
- Claude의 읽기 전용 로그인 상태

검사는 AI 모델을 호출하지 않고 알림도 보내지 않는다. 홈 DB와 필요한 테이블은 만들지만 기존 작업·결과를 지우지 않는다. `ok`는 검사 통과, `missing`은 필요한 조치, `optional`은 사용하려면 준비할 작업자, `manual`은 직접 확인할 항목이다.

## 로그인

실행 폴더와 관계없이 같은 OS 사용자는 `~/.agent-outsource/agent-outsource.sqlite`를 공유하며 로그도 그 디렉터리의 `agent-outsource.sqlite.logs/`에 저장한다. 홈 바로 아래의 `agent-outsource.sqlite` 또는 이전 `ai-oc.sqlite`가 있으면 정지된 DB와 로그를 함께 옮긴다. 실행 중 작업·질문이 있으면 먼저 정상 완료하고, 이전 서비스를 정지해 WAL/SHM 연결이 닫힌 뒤 이전한다. 두 DB가 있거나 열린 연결이 남으면 덮어쓰지 않고 중단한다.

- Claude: 터미널에서 `claude auth login`을 실행하고 표시되는 로그인 절차를 따른다.
- Antigravity: 터미널에서 `agy`를 열고 로그인한다. 셋업은 agy의 로그인 완료를 자동 판정하지 않는다.
- Codex: Codex 앱의 로그인과 실행 중인 대화를 사용한다. 셋업이 queue 도움말을 확인해도 실제 알림 수신까지 검사한 것은 아니다.

비밀번호나 인증 토큰을 Codex 대화에 붙여 넣을 필요가 없다. 로그인 후 셋업을 다시 요청하거나 README의 작은 첫 작업으로 사용을 시작한다.

## 실행파일을 찾지 못할 때

CLI를 설치한 뒤 Codex를 다시 열어 새 PATH가 적용되게 한다. 프로그램은 PATH와 일반적인 사용자 설치 위치를 확인한다. Windows에서는 네이티브 `.exe`를 사용한다. 직접 경로를 지정해야 한다면 `AI_OC_CLAUDE`, `AI_OC_AGY`, `AI_OC_CODEX` 환경변수에 해당 실행파일 경로를 설정하고 Codex를 다시 연다. 명령 문자열이나 인증 토큰을 넣는 설정이 아니다.

`codex queue`가 없으면 해당 명령을 지원하는 Codex CLI가 필요하다. 셋업은 Codex를 자동 업데이트하거나 앱 설정을 바꾸지 않는다.

## 직접 셋업 실행

Codex 스킬 호출 대신 터미널을 사용하고 싶다면 설치된 `agent-outsource-setup` 폴더에서 실행한다.

```sh
node scripts/setup.mjs
```

JSON 결과는 `node scripts/setup.mjs --json`으로 받을 수 있다. 저장소를 직접 내려받았다면 저장소 루트에서 `npm run setup`을 실행해도 된다. 둘 다 추가 npm 의존성 없이 실행된다.

작업 실행은 `$agent-outsource`에 요청한다. 모든 실행의 권한은 자동 승인되며, 사용자 선택이 필요한 일반 질문에는 답을 기다린다.

## Claude 모델 목록 갱신 의존성

일반 외주 실행과 Antigravity 목록에는 추가 npm 설치가 필요 없다. Claude 목록을 갱신하려면 설치된 `agent-outsource` 스킬 폴더에서 한 번 실행한다.

```sh
npm install --ignore-scripts
```

그다음 Codex에 “Claude 모델 목록 갱신해 줘”라고 요청한다. 공식 Agent SDK 0.3.280의 supportedModels()로 설치된 Claude CLI와 사용자 설정의 선택 목록을 읽는다. 현재 로그인 환경을 CLI가 처리하며 별도 API 키를 요구하거나 토큰을 읽어 출력하지 않는다. 로그인·설정에 따른 선택용 별칭 목록이며 개별 모델 실행 권한을 실제 호출로 검사하지 않는다. 최초 캐시가 없거나 조회가 실패하면 그 상태를 그대로 안내한다. 자동 갱신/패키지 자동 설치는 없다.

## Codex workspace-write에서 공유 DB 쓰기

사용자가 공유 디렉터리 쓰기를 승인한 경우 사용자 Codex config.toml의 기존 설정을 보존하면서 아래 항목에 **전용 디렉터리 하나만** 추가한다. 경로는 자기 사용자 홈의 실제 절대 경로로 바꾼다. 기존 writable_roots가 있으면 합쳐서 보존한다.

```toml
[sandbox_workspace_write]
writable_roots = ["C:/Users/YOUR_USER/.agent-outsource"]
```

홈 전체 쓰기, danger-full-access, 승인 정책 해제는 필요하지 않다. 공식 설정: https://learn.chatgpt.com/docs/config-file/config-reference . 원격 호스트는 그 호스트의 사용자 경로와 Codex 설정에 별도로 적용한다. 로컬 설정이 원격 컴퓨터에 전파되는 것은 아니다.

설정 변경이 현재 작업의 권한을 소급 변경한다고 가정하지 않는다. 새 workspace-write 작업에서 SQLite WAL/쓰기와 로그 생성을 승인 상승 없이 실제 확인한다. 앱이 다른 권한 프로필을 강제하면 이 설정만으로 적용되지 않을 수 있으므로 유효 roots를 확인한다. 기존 승인 대기 작업은 새 권한으로 다시 열거나 앱이 지원하는 방식으로 갱신해야 한다. 실제 작업을 중복 제출하지 않는다.

setup 스킬의 명시적 실행 요청에는 위 전용 폴더의 쓰기 허용 설정이 포함된다. 스킬은 `CODEX_HOME/config.toml`(미설정 시 `~/.codex/config.toml`)을 읽고 이미 해당 폴더 또는 상위 폴더가 허용됐으면 변경하지 않는다. 누락됐으면 기존 배열·주석·다른 설정을 보존하며 전용 폴더만 병합하고 다시 읽어 확인한다. 기존 TOML이 잘못됐거나 `default_permissions`/`[permissions]` 프로필을 사용하는 경우 덮어쓰거나 설정 방식을 혼합하지 않고 필요한 조치를 보고한다. 샌드박스 모드와 승인 정책은 유지한다.

설정 결과(기존 등록/추가/미설정)와 실제 쓰기 검사 결과를 구분해 보고한다. 검사 프로그램은 DB의 쓰기 트랜잭션 시작/롤백과 임시 로그 쓰기를 확인한다. `node scripts/setup.mjs`나 `npm run setup`을 직접 실행하면 검사 프로그램만 동작하며 Codex 설정은 편집하지 않는다. CLI 실행·인증·네트워크에 대한 별도 승인까지 면제하지 않는다.
