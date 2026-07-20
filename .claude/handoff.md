# Handoff — 2026-07-21

**Branch:** lee

## Did this session
- 윈도우에서 하던 레포를 맥에 새로 클론하고 `lee` 브랜치로 체크아웃, origin과 동기화 확인
- 기기 간(윈도우 ↔ 맥) 작업 이어가는 워크플로우 정리: 마무리 시 push, 시작 시 pull 습관화하기로 함
- `handoff` 스킬 제작 (로컬 + 계정 스킬로 업로드 완료) — 세션 종료/시작 시 이 노트를 자동으로 남기고 읽어주는 용도
- `.claude/handoff.md`가 루트 gitignore에 안 걸리는 것 확인 (팀원별 gitignore는 각자 폴더 하위에만 적용됨) — 그냥 커밋해서 MR에 같이 포함시키기로 결정
- `/handoff` save/load 트리거 실제로 연습해봄
- 옵시디언 볼트(모션톡 프로젝트 문서)에 `09_Claude` 폴더 신설, 플러그인 정리 문서 이동 + 핸드오프 사용법/개발 워크플로우 문서 신규 작성 (레포 밖 별도 작업, git과 무관)
- handoff 스킬 정책 수정: 미완성 코드도 커밋하는 걸 기본값으로(`wip:` 접두사), "In progress / not committed" 섹션은 예외 상황 전용으로 재정의. 트리거 워딩도 "저장"/"불러오기"로 통일
- 브랜치 전략 확인: `lee` 브랜치 하나로 계속 통합 작업하는 게 맞음 (인당 1브랜치 1MR 팀 컨벤션, dev-guidelines §2 "기능 브랜치로 작업"과도 상충 없음) — 기능별 서브 브랜치 안 팜
- 코드 변경 없음 (연습/설정/문서화/워크플로우 정리 세션)

## In progress / not committed
(없음 — working tree 깨끗함, `.DS_Store` 파일들만 untracked 상태)

## Next
- MotionTok/Backend 쪽 실제 작업 이어서 시작
