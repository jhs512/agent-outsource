# Antigravity 훅 실패 복구

2026-09-23 Windows / agy 1.2.8.

실제 데모는 PreToolUse JSON 훅의 경로 오류 뒤 invalid UTF-8 protobuf 오류로 종료됐다. 등록된 orca-status 명령 5개가 모두 없는 `.orca/agent-hooks` 파일을 가리켰다. 해당 명령만 실행해도 exit 1 경로 오류가 재현됐으며, Orca 실행 파일·설치 등록·실행 프로세스도 확인되지 않았다.

로컬 hooks.json을 별도 백업하고, 공식 per-hook `enabled: false`를 orca-status에만 적용했다. 다른 훅을 삭제하거나 보안 검사를 우회하지 않았으며 기존 핸들러 정의도 보존했다. 이 PC의 고아 통합에 대한 수동 복구이며 스킬이 사용자 설정을 자동 수정하지 않는다.

한 번의 실제 CLI 스모크에서 run_command, write_to_file, view_file이 모두 성공했고 도구 오류 0, exit 0, SUCCESS를 확인했다. 파일 내용 HOOK_OK도 직접 확인했다. 다만 agy의 현재 디렉터리는 CLI 프로세스 cwd와 달리 scratch였으므로 지정 작업 폴더에 파일이 생겼다는 검사는 실패했다. 스킬에 절대 작업·출력 경로 전달과 실제 산출물 위치 확인을 명시했다. 원래 데모를 중복 실행하지 않았다.

런타임은 step_update의 최초 JSON hook 실패를 기억해 종료 코드·후속 UTF-8 오류에 묻히지 않도록 failed 요약에 훅 이름과 복구 안내를 보존한다. fixture가 실제 오류 이벤트 순서를 재현하는 회귀 검사는 수정 전 CLI exited 3으로 실패했고 수정 후 통과했다. 전체 21개 검사 통과. 실패 작업은 자동 재실행하지 않는다.
