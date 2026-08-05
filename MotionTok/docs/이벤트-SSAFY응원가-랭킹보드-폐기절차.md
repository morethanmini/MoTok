# SSAFY 응원가 이벤트 랭킹보드 — 구성과 폐기 절차

한시적 이벤트라 **언제든 접을 수 있게** 만들었다. 이 문서는 "무엇이 추가됐고, 끄려면 뭘 지우면
되는지"만 적는다. 설계 배경은 [S15P11A706-186](https://ssafy.atlassian.net/browse/S15P11A706-186).

## 무엇인가

랭킹 화면에서 **캐치캐치리듬**을 고르면 세 번째 탭 `SSAFY 응원가`가 생긴다. 채보
`ssafy-fighting-manual`(어려움 풀)로 친 판만 모은 **최고점 랭킹**이다.

- 만점 **41,200점** (233노트 × Perfect 100 × 콤보 배율, 최대 2.0)
- 만점자가 여럿이면 **먼저 찍은 사람이 위** — 본 랭킹과 같은 tie-break
- 솔로·멀티를 합쳐서 센다 (리듬은 각자 치는 게임이라 구분할 이유가 없다)
- 확인용으로 플레이 횟수를 같이 보여준다 (순위에는 쓰이지 않는다)

## 왜 본 랭킹을 안 건드렸나

`leaderboards`에 `chart_id`를 넣고 유니크를 바꾸는 방법도 있었지만, 되돌릴 때 같은 유저·게임의
곡별 행을 하나로 합쳐야 하는데 **어느 점수를 남길지 정할 수가 없어 데이터가 깎인다.**

그래서 옆에 별도 테이블을 두고 **같은 판을 양쪽에 중복 저장**한다. 중복이 낭비가 아니라
안전장치다 — 이벤트 테이블을 통째로 버려도 역대·주간 랭킹이 멀쩡한 것이 "언제든 접을 수 있다"의
조건이다. 유저당 1행이라 용량도 문제되지 않는다.

## 데이터만 비우기 (이벤트 기간 리셋 등)

```sql
DELETE FROM chart_leaderboard WHERE chart_id = 'ssafy-fighting-manual';
```

본 랭킹은 영향 없다. 화면은 그대로 두고 순위만 0에서 다시 시작한다.

## 완전히 걷어내기

**1. 테이블**

```sql
DROP TABLE chart_leaderboard;
```

**2. 백엔드 — 파일 삭제**

- `game/entity/ChartLeaderboard.java`
- `game/repository/ChartLeaderboardRepository.java`

**3. 백엔드 — 부분 제거**

| 파일 | 지울 것 |
|---|---|
| `game/model/LeaderboardPeriod.java` | `CHART` 값 |
| `game/GameQueryService.java` | `chartRepository` 필드, `switch`의 `CHART` 분기 3곳, `chart` 파라미터 |
| `game/GameRestController.java` | `chart` 쿼리 파라미터 |
| `game/GameSettlementService.java` | `chartRepository` 필드, `if (chartId != null)` 블록 |
| `game/GameSettledEvent.java` | `chartId` 컴포넌트 (남겨도 무해) |
| `rhythm/RhythmSessionService.java` | `SONG_MAX_SCORE`·`maxScoreOf` (남기는 걸 권함 — 아래 참고) |
| `rhythm/model/RhythmSession.java` | `songId` (남겨도 무해) |

**4. 프론트 — 부분 제거**

| 파일 | 지울 것 |
|---|---|
| `features/ranking/RankingView.vue` | `EVENT_BOARD` 상수, `PERIODS`의 `CHART` 줄, `isChart`/`hasEventBoard`/`showModeSwitch`, 각 라벨의 `isChart` 분기 |
| `api/types.ts` | `LeaderboardPeriod`의 `'CHART'` |
| `api/modules/games.ts` | `chart` 인자 |
| `__tests__/rankingSearch.spec.ts` | `CHART_BOARD`, 응원가 탭 테스트 5건 |

## 남기는 걸 권하는 것

**`SONG_MAX_SCORE` (점수 상한)** — 이벤트와 무관하게 고쳐야 했던 문제다.

`MAX_SCORE = 91,200`은 **60초 랜덤 채보** 기준으로 계산된 값인데, 곡 지정 라운드는 곡 길이만큼
돈다. 어려움(풀)은 127초를 돌지만 노트가 233개뿐이라 만점이 41,200이고, 상한이 만점의 **2.2배**라
그 틈만큼 위조 여지가 열려 있었다. 채보별 상한은 이벤트가 끝나도 유효한 방어다.

> ⚠️ **채보를 수정하면 `SONG_MAX_SCORE`도 같이 고쳐야 한다.** 노트 수가 바뀌면 만점이 바뀐다.
> 목록에 없는 곡은 `MAX_SCORE`로 폴백하므로 새 채보를 올려도 정상 점수가 잘리지는 않는다.

## 이벤트 운영 시 주의

**점수는 클라이언트가 계산해서 올린다.** 서버는 범위 클램프만 한다(핑거 스타와 같은 신뢰 모델).
채보별 상한을 걸어 "불가능한 점수"는 막았지만, **41,200 이하의 위조는 여전히 가능하다.**

상품이 걸린 이벤트이므로 **수상자는 수동 검증**(플레이 영상·판정 로그 확인)을 절차로 두는 것을
권한다. 이건 코드로 막을 수 있는 종류가 아니다.

## 알려진 한계

- **이벤트 시작 = 0부터.** 이전에 응원가를 친 기록은 곡 정보가 저장되지 않던 시절이라 복원할 수
  없다. 보드는 배포 이후 친 판만 담는다.
- **기간 제한이 없다.** 시작·마감을 코드로 강제하지 않는다 — 마감은 그 시점의 보드를 캡처해서
  판단하고, 필요하면 위 `DELETE`로 비운다. 기간이 꼭 필요해지면 `week`처럼 파라미터를 하나 더
  붙이는 쪽이 맞다(테이블 구조는 그대로 쓸 수 있다).
- **캐치캐치리듬 본 랭킹은 여전히 섞여 있다.** 역대·주간 탭에는 Neon_Pulse 랜덤 채보와 응원가
  3개 변형이 한 컬럼에 들어간다. 곡별 분리는 이벤트가 아니라 게임② 랭킹 자체의 문제라 별도
  이슈로 남긴다.
