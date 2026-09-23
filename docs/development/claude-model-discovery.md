# Claude 모델 목록 조회 검증

2026-09-23 Claude Code 2.1.280 / 공식 Agent SDK 0.3.280 기준.

CLI 도움말에 독립 models 명령이 없다는 초기 확인만으로 미지원 처리한 것은 불충분했다. 공식 SDK의 supportedModels()가 설치된 CLI를 초기화해 선택 목록을 제공함을 확인했다. 현재 로그인은 claude.ai/firstParty였으며 사용자 메시지를 보내지 않은 control 초기화로 5개 선택 항목을 얻었다. 토큰·이메일·계정 ID는 출력하거나 저장하지 않았다.

실제 반환값은 default, opus[1m], claude-fable-5-1[1m], sonnet, haiku였다. 이는 사용자 설정과 현재 CLI 환경의 selector 값으로, 정확한 모델 ID만 모은 목록이나 각 모델에 대한 호출 권한·실시간 용량 보장은 아니다. 모델 추론은 수행하지 않았다. user 설정만 로드하므로 특정 프로젝트 설정에 따른 차이는 반영하지 않는다.

별도 API 키를 쓰는 GET /v1/models는 API 카탈로그다. 해당 키를 요구하거나 기존 Claude 로그인 토큰을 API 키처럼 전용하지 않았고 두 종류의 목록을 혼합하지 않았다. 정적 별칭을 현재 계정 조회 결과로 위장하지 않았다.

SDK는 스킬 폴더의 package.json/package-lock.json에 고정하며 최초 Claude 목록 갱신 전에 npm install --ignore-scripts로 준비한다. 일반 작업/캐시 읽기/Antigravity 목록은 SDK를 로드하지 않는다. 갱신은 명시 요청으로만 실행되며 SDK 오류·timeout·빈목록·잘못된 응답 시 기존 목록과 성공시각을 유지한다. 캐시는 source와 scope를 표시한다.

검증: 지원 SDK 메서드의 패키지 타입 정의 확인, 현재 로그인으로 실조회, 설치본 bridge models-refresh에서 5개 저장 및 source/scope 확인. 모델캐시 관련 6개 테스트 통과(무프롬프트 초기화, 세션 close, timeout, 원자 rollback, 기존 snapshot 보존 포함).

공식 근거:
- https://code.claude.com/docs/en/agent-sdk/typescript
- https://code.claude.com/docs/en/agent-sdk
- https://code.claude.com/docs/en/model-config
- https://platform.claude.com/docs/en/api/models
- https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk

공식 TypeScript 문서 본문은 조회 도구의 크기 제한에 걸려, 동일 공식 배포 패키지 sdk.d.ts의 supportedModels() 선언과 실제 반환값으로 교차 확인했다.
