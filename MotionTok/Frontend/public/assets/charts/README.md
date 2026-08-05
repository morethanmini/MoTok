# 번들 채보 자산 (S15P11A706-168)

채보 랩(`/dev/chart-lab`)의 **[게임 번들]** 버튼으로 내보낸 수제 채보를 게임에 싣는 폴더.

## 규약

곡 하나(=시작 화면의 버튼 하나)당 폴더 하나:

```
public/assets/charts/<id>/
├── bundle.json   ← 랩이 내보낸 `곡명-난이도-bundle.json`을 이 이름으로
└── <곡 파일>     ← bundle.json의 song.file 값과 같은 이름 그대로 (wav/mp3)
```

- `<id>`는 소문자·숫자·하이픈만 (서버 검증과 일치해야 한다)
- 곡 목록 노출은 `src/features/games/catch-rhythm/generator/bundledCharts.ts`의
  `BUNDLED_SONGS`에 한 줄 추가

## 현재 등록된 곡 (자산은 채보 제작자가 커밋)

| id | 내용 |
|---|---|
| `ssafy-fighting-manual` | SSAFY Fighting 풀버전 · MANUAL 수제 채보 |
| `ssafy-fighting-manual-verse1` | 위 MANUAL을 1절(80.5초)에서 자른 버전 — `docs-personal/S15P11A706-168/채보들/make-verse1.mjs`로 생성. 풀곡 채보를 갈아끼우면 이것도 재생성할 것 |
| `ssafy-fighting-extreme` | SSAFY Fighting 컷버전 · EXTREME 수제 채보 |
