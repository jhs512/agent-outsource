# ai-oc

**Codex에서 Claude Code와 Antigravity CLI에 작업을 맡기는 로컬 스킬입니다.**

Codex에 말이나 글로 요청하면 지정한 CLI가 작업하고, 질문이나 완료 결과가 원래 Codex 대화로 돌아옵니다. 질문에 답하면 같은 작업자 대화를 이어갑니다.

> 작업자는 항상 `--dangerously-skip-permissions`로 실행됩니다. 파일 수정이나 명령 실행에 별도 권한 확인을 하지 않으므로, 맡길 프로젝트와 작업 범위를 분명히 지정하세요. 일반 질문에는 사용자의 답을 기다립니다.

## 1. 설치하기

먼저 준비하세요.

- [Node.js 24 이상](https://nodejs.org/en/download)
- Codex 데스크톱과 `codex queue`를 지원하는 Codex CLI
- 사용할 작업자: [Claude Code](https://code.claude.com/docs/en/overview) 또는 [Antigravity CLI](https://antigravity.google/docs/cli/overview/). 설치 후 각 CLI에서 로그인하세요.

터미널에서 실행하면 두 스킬을 Codex에 전역 설치합니다.

```sh
npx --yes skills@latest add jhs512/ai-oc --global --skill "*" --agent codex --copy --yes
```

Codex와 Claude Code 양쪽에 스킬 파일을 설치하려면 다음 명령을 사용하세요.

```sh
npx --yes skills@latest add jhs512/ai-oc --global --skill "*" --agent codex claude-code --copy --yes
```

`--agent`는 스킬의 설치 대상을 지정합니다. 현재 작업 조정과 결과 수신은 **Codex 대화와 `codex queue`에 의존**하므로, 아래 사용 예시는 Codex에서 실행하세요. Claude Code에 파일을 설치해도 Claude Code가 조정 호스트로 지원되는 것은 아닙니다.

설치된 스킬은 다음 턴부터 사용할 수 있습니다. 스킬 실행을 위한 별도 `npm install`은 필요하지 않습니다.

| 스킬 | 용도 |
|---|---|
| `cli-worker-bridge-setup` | 최초 셋업·환경 진단: Node, CLI, 로그인 상태, Codex 알림 명령, SQLite 확인 |
| `cli-worker-bridge` | 작업 위임, 사용자 질문·답변 전달, 같은 작업자 세션 재개, 결과 수신 |

## 2. 셋업하기

```text
$cli-worker-bridge-setup으로 실행 준비를 확인해 줘.
```

자연어로 요청해도 됩니다.

```text
cli-worker-bridge-setup 스킬로 처음 사용할 준비가 됐는지 확인하고,
설치나 로그인이 필요한 항목을 알려 줘.
```

Node·작업자 CLI·Codex 알림 명령을 검사하고, 홈 폴더에 작업 기록용 SQLite DB를 준비합니다. 로그인 등 직접 확인해야 하는 항목은 따로 안내합니다. 셋업만으로 AI 작업을 실행하거나 운영체제 자동 시작 서비스를 등록하지 않습니다.

## 3. 첫 작업 맡기기

프로젝트를 연 Codex 대화에서 사용할 CLI와 할 일을 지정하세요.

```text
$cli-worker-bridge로 Claude Code에게 현재 프로젝트의 README를 읽고
핵심을 세 줄로 요약하게 해 줘. 파일은 수정하지 마.
```

```text
$cli-worker-bridge로 Antigravity CLI에게 현재 프로젝트의 파일 구성을
설명하게 해 줘. 파일은 수정하지 마.
```

질문이 오면 그대로 답하세요. 이후에는 “같은 작업자 대화에서 설치 방법도 설명하게 해 줘”처럼 이어갈 수 있습니다. 완료 알림은 작업을 맡긴 Codex 대화로 돌아옵니다.

## 더 알아보기

- [설치·로그인·셋업 문제 해결](docs/setup.md)
- [명령과 작업 기록 확인](skills/cli-worker-bridge/references/commands.md)
- [지원 범위와 제한](docs/limitations.md)
- [공개 개발 기록과 테스트](docs/development/README.md)

Windows에서 실제 CLI 연동을 검증했습니다. 완료 알림에 의한 Codex 대화 재개는 확인했으며, 음성 통화 중 자동 발화는 별도 미검증입니다.
