# Antigravity 훅 실패 복구

2026-09-23 Windows / agy 1.2.8.

실제 데모는 PreToolUse JSON 훅의 경로 오류 뒤 invalid UTF-8 protobuf 오류로 종료됐다. 등록된 orca-status 명령 5개가 모두 없는 `.orca/agent-hooks` 파일을 가리켰다. 해당 명령만 실행해도 exit 1 경로 오류가 재현됐으며, Orca 실행 파일·설치 등록·실행 프로세스도 확인되지 않았다.

로컬 hooks.json을 별도 백업하고, 공식 per-hook `enabled: false`를 orca-status에만 적용했다. 다른 훅을 삭제하거나 보안 검사를 우회하지 않았으며 기존 핸들러 정의도 보존했다. 이 PC의 고아 통합에 대한 수동 복구이며 스킬이 사용자 설정을 자동 수정하지 않는다.

한 번의 실제 CLI 스모크에서 run_command, write_to_file, view_file이 모두 성공했고 도구 오류 0, exit 0, SUCCESS를 확인했다. 파일 내용 HOOK_OK도 직접 확인했다. 다만 agy의 현재 디렉터리는 CLI 프로세스 cwd와 달리 scratch였으므로 지정 작업 폴더에 파일이 생겼다는 검사는 실패했다. 스킬에 절대 작업·출력 경로 전달과 실제 산출물 위치 확인을 명시했다. 원래 데모를 중복 실행하지 않았다.

런타임은 step_update의 최초 JSON hook 실패를 기억해 종료 코드·후속 UTF-8 오류에 묻히지 않도록 failed 요약에 훅 이름과 복구 안내를 보존한다. fixture가 실제 오류 이벤트 순서를 재현하는 회귀 검사는 수정 전 CLI exited 3으로 실패했고 수정 후 통과했다. 전체 21개 검사 통과. 실패 작업은 자동 재실행하지 않는다.

## 재개된 데모의 남은 provider 오류

후속 데모의 step 31 브라우저 검증은 All Passed:true였지만 native 최종 status는 ERROR/invalid UTF-8였다. stdout JSONL 전체는 strict UTF-8 디코딩에 성공했고 stderr는 0바이트였다. step 7/15/41/43의 PowerShell 기본 표 출력에서 U+FFFD가 확인됐으며 최초 두 번은 서버 시작 전이었다. step 33 서버 로그는 ASCII 47바이트이고 명령은 529초 동안 foreground 대기했다. 따라서 훅 오류 재발이나 서버 종료 stderr로 단정할 근거가 없고, 현재 실행에서 provider가 수집한 텍스트의 손상이 관찰된다. 이전 conversation의 손상 데이터가 최종 오류에 기여했는지는 외부 로그로 구분할 수 없다.

모델 없이 현재 셸에서 PowerShell 한글 출력을 직접 비교하면 기본/명시 UTF-8 모두 정상이라 agy 내부 실행 환경의 오류를 독립 재현하지 못했다. provider 내부 원인을 확정하거나 코드로 덮지 않았다. 스킬에 명령별 UTF-8 지정·불필요한 표 출력 억제 및 preview 서버 분리/로그 리다이렉션/PID/유한 readiness 확인을 추가했다. 실제 데모나 모델은 다시 실행하지 않았으며 기존 failed 상태와 산출물을 유지했다.

## 실제 호출 수정과 비교 검증

추가 허가 후 최소 읽기 전용 비교를 진행했다. 새 세션과 기존 세션에 같은 디렉터리 조회를 실행했을 때 모두 코드 페이지 949와 깨진 표 출력이 나왔지만, 새 세션은 SUCCESS이고 기존 세션은 ERROR였다. 기존 세션에 UTF-8을 명시하면 표 출력과 코드 페이지 65001은 정상이지만 누적 최종 ERROR는 유지됐다. 따라서 기존 세션의 실패를 현재 출력만 고쳐 정상화할 수 없음을 확인했다.

런타임은 agy의 지원되는 --json-schema를 사용하고 Windows 명령별 UTF-8 지침을 실제 prompt에 전달한다. 새 production job에서 native SUCCESS, completed, 한글 확인 원문/65001, 대체 문자 없음과 완료 이벤트 전송을 확인했다. 자동 재시도나 기존 실패 승격은 없다. Claude 질문 왕복 등 기존 회귀와 새 ERROR 보존 검사 포함 22개 통과. 원래 앱과 프리뷰 서버는 변경하지 않았다.
