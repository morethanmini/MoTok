<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RouteName } from '@/router/routeNames'
import { gamesApi, roomsApi, ApiError, type Game, type GameDetail } from '@/api'
import { useGameCatalog } from '@/composables/useGameCatalog'
import { useSessionStore } from '@/stores/session'
import { useToast } from '@/composables/useToast'
import AppHeader from '@/components/common/AppHeader.vue'
import PixelModal from '@/components/common/PixelModal.vue'
import PixelButton from '@/components/common/PixelButton.vue'
import PixelToast from '@/components/common/PixelToast.vue'
import RhythmThumbnail from './components/RhythmThumbnail.vue'
import FingerStarThumbnail from './components/FingerStarThumbnail.vue'
import DrawingThumbnail from './components/DrawingThumbnail.vue'
import BodyFitThumbnail from './components/BodyFitThumbnail.vue'
import FishingThumbnail from './components/FishingThumbnail.vue'
import GameGuideCarousel from './guide/GameGuideCarousel.vue'
import { guidePagesFor } from './guide/pages'
import heroFishingCat from '@/assets/games-catalog/hero-fishing-cat-transparent.png'
import lobbyRoomListBoard from '@/assets/lobby/lobby-room-list-board.png'
import lobbyGardenGrassTile from '@/assets/lobby/lobby-garden-grass-tile.png'

const router = useRouter()
const session = useSessionStore()
const { message: toast, flash } = useToast()

const GAME_TONE = ['sky', 'mint', 'peach', 'lilac', 'butter']
/**
 * 캐치캐치리듬 — 이 게임 카드만 레이어형 썸네일(RhythmThumbnail)을 쓴다.
 * ⚠️ 실제 백엔드 시더(RhythmGameSeeder) 기준 id=2. 프론트 MOCK_GAMES에는 id=3 "리듬 터치"라는
 * 목데이터 전용 항목이 있지만 백엔드엔 존재하지 않는 이름이라 대응하지 않는다(id=3 확인 결과 반영).
 */
const RHYTHM_GAME_ID = 2
/** 핑거 스타 — 전용 썸네일(FingerStarThumbnail)을 쓴다. 백엔드 시더 기준 id=1. */
const FINGER_STAR_GAME_ID = 1
/**
 * 그림으로 말해요 — 이 게임 카드만 레이어형 썸네일(DrawingThumbnail)을 쓴다.
 * 실제 백엔드 시더(GameCatalogSeeder) 기준 id=10 (2026-07-30 확인 후 MOCK_GAMES도 10으로 맞춤).
 */
const DRAWING_GAME_ID = 10
/**
 * 몸 끼워 맞추기 — 이 게임 카드만 레이어형 썸네일(BodyFitThumbnail)을 쓴다.
 * 실제 백엔드 시더(GameCatalogSeeder.seedBodyFit) 기준 id=4 — game-room/data.ts의
 * GAME_CATALOG(gameId:4, "BODY FIT")과도 대조해 일치 확인함(2026-07-30).
 * ⚠️ MOCK_GAMES의 "자세 매치"(id=5)를 이 게임과 같은 것으로 보고 5를 쓰면 안 된다 —
 * 이름·설명이 다른 별개 항목이라 그대로 두었다(아래 MOCK_GAMES 주석 참고).
 */
const BODY_FIT_GAME_ID = 4
/**
 * 모션 낚시 — 이 게임 카드만 레이어형 썸네일(FishingThumbnail)을 쓴다.
 * 실제 백엔드 시더(GameCatalogSeeder, "game catalog seeded: id=11 모션 낚시") 기준 id=11 —
 * game-room/data.ts의 GAME_CATALOG(gameId:11, "모션 낚시")과도 대조해 일치 확인함(2026-07-31).
 * 이름이 완전히 같은 항목이라(그림으로 말해요 6→10 전례와 동일 패턴) MOCK_GAMES의 id도
 * 2에서 11로 맞췄다(아래 MOCK_GAMES 주석 참고).
 */
const FISHING_GAME_ID = 11
/**
 * 로딩 중에 세워 둘 자리표시자 카드 수.
 *
 * <b>예시 게임 목록(폴백)을 쓰지 않는 이유.</b> 전에는 목데이터 5개를 먼저 그리고 서버 응답으로
 * 갈아치웠는데, 두 목록의 <b>내용·순서·카드 종류가 모두 달라</b> 그 순간 그리드가 통째로 다시
 * 그려졌다(목록에 없던 id가 들어오면서 `:key`가 바뀌어 카드가 재마운트되고, 전용 썸네일 ↔ 일반
 * 이미지로 카드 종류까지 바뀌어 높이가 달라졌다). 게다가 목데이터에는 백엔드에 존재하지 않는
 * 게임이 섞여 있어, 잠깐이지만 <b>없는 게임을 보여 주고</b> 있었다.
 *
 * 이 숫자는 눈에 보이는 채움일 뿐이고 데이터가 아니다 — 실제 개수와 달라도 카드가 한 번 정착하는
 * 정도이고, 잘못된 게임을 보여 주지는 않는다.
 */
const SKELETON_CARDS = 5
const {
  games,
  loading: gamesLoading,
  error: listError,
  stale: listStale,
  reload: reloadGames,
} = useGameCatalog()
const visibleGames = computed(() => session.isGuest ? games.value.filter((g) => g.minPlayers === 1) : games.value)
const detail = ref<GameDetail | null>(null)
const detailOpen = ref(false)
const selected = ref<Game | null>(null)
const soloPlayable = computed(() => !!selected.value?.playable && selected.value.minPlayers <= 1)
/**
 * 그림 설명이 있는 게임이면 서버 글(rules/controls) 대신 그림을 보여준다.
 * selected(고른 카드)를 기준으로 잡는 이유 — detail은 서버 응답을 기다리는 동안
 * "불러오는 중" 자리표시자라, 그걸 보면 모달이 열리자마자 글이 잠깐 보였다 그림으로 바뀐다.
 */
const guidePages = computed(() => (selected.value ? guidePagesFor(selected.value.id) : null))
const starting = ref(false)
/**
 * 관리자가 닫은 게임(-106)인지. `playable`이 false인 이유는 두 가지고(닫힘 / 인원 부족)
 * 사용자가 취할 행동이 다르다 — 하나는 기다리는 것, 하나는 친구를 부르는 것.
 * 서버가 두 값을 따로 주므로 문구도 나눈다.
 */
const closedByAdmin = (game: Game) => !game.active

/**
 * 전용 썸네일 컴포넌트가 없는 게임의 그림 — 서버가 준 주소를 쓴다.
 *
 * 전에는 여기에 id별 하드코딩 표(GAME_ART)가 있었는데 한 줄도 도달하지 않았다. 3·5는 백엔드에
 * 없는 게임(목데이터 전용)이었고, 10·11은 전용 썸네일이 앞서 걸려 이 경로까지 오지 않았다.
 */
function artFor(game: Game) { return game.thumbnailUrl }
function toneFor(game: Game) { return GAME_TONE[game.id % GAME_TONE.length] }
function isRhythm(game: Game) { return game.id === RHYTHM_GAME_ID }
function isFingerStar(game: Game) { return game.id === FINGER_STAR_GAME_ID }
function isDrawing(game: Game) { return game.id === DRAWING_GAME_ID }
function isBodyFit(game: Game) { return game.id === BODY_FIT_GAME_ID }
function isFishing(game: Game) { return game.id === FISHING_GAME_ID }
async function openDetail(game: Game) {
  selected.value = game
  detailOpen.value = true
  detail.value = { id: game.id, name: game.name, rules: '게임 규칙을 불러오는 중이에요.', controls: '' }
  try { detail.value = await gamesApi.detail(game.id) }
  catch {
    detail.value = { id: game.id, name: game.name, rules: game.description || '카메라 앞에서 즐기는 모션 게임이에요.', controls: '카메라 앞에서 안내에 맞춰 몸을 움직여 주세요.' }
  }
}
async function play() {
  const game = selected.value
  if (!soloPlayable.value || !game || starting.value) return
  if (session.isGuest) {
    if (!session.guestRoomId) return flash('게스트 게임 정보가 없어요. 처음 화면에서 다시 시작해 주세요.')
    return goDevice(game, session.guestRoomId)
  }
  starting.value = true
  try {
    const result = await roomsApi.create({
      title: `${session.profile?.nickname ?? '나'}의 1인 플레이`.slice(0, 30),
      // 실시간 방 서버는 최소 2명 정원을 요구한다. 혼자일 때의 빈 슬롯은 게임 화면에서만 숨긴다.
      visibility: 'PRIVATE', maxPlayers: 2,
      password: String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    })
    goDevice(game, result.roomId)
  } catch (error) { flash(error instanceof ApiError ? error.message : '방을 만들지 못했어요. 다시 시도해 주세요.') }
  finally { starting.value = false }
}
function goDevice(game: Game, roomId: string) {
  detailOpen.value = false
  // 목록을 한 번도 받지 못하면 카드가 안 그려져 여기까지 오지 않는다(listError). 여기 걸리는 건
  // 직전에 성공한 목록을 보고 있는 경우(listStale) — 그 사이 관리자가 게임을 닫았으면 서버가 시작을
  // 거부하고 사용자에겐 그냥 "안 열리는 화면"이 된다. 조용히 빼면 그 이유를 알 길이 없다.
  if (listStale.value) flash('게임 목록이 최신이 아니라 자동 시작을 건너뜁니다 — 방에서 직접 골라 주세요')
  router.push({
    name: RouteName.DeviceSetup,
    query: {
      game: game.name,
      room: roomId,
      solo: '1',
      // 혼자 플레이는 발행을 받을 사람이 없어 캠·마이크를 끈 채로 시작한다.
      // 게임 입력은 로컬 캡처를 쓰므로 꺼도 플레이된다. 대기실에서 켜면 그 선택이 방까지 간다.
      cam: '0',
      mic: '0',
      // autostart — 대기실에서 입장하면 방에서 다시 고르지 않고 이 게임이 바로 열린다.
      // 게임룸이 GAME_CATALOG의 gameId로 찾으므로 서버 게임 id를 그대로 넘긴다.
      ...(listStale.value ? {} : { autostart: String(game.id) }),
    },
  })
}
</script>

<template>
  <div class="catalog-page px-paper-bg">
    <AppHeader />
    <main class="catalog-shell">
      <section class="catalog-intro">
        <div class="intro-copy">
          <span class="eyebrow">SOLO PLAYGROUND</span>
          <h1>오늘은 어떤 움직임으로 놀까요?</h1>
          <p>카메라 앞에서 바로 시작할 수 있는 모션 게임을 골라 보세요.</p>
        </div>
        <div class="intro-art" aria-hidden="true"><img :src="heroFishingCat" alt="" /><span class="art-grass" :style="{ backgroundImage: `url(${lobbyGardenGrassTile})` }" /></div>
      </section>

      <div v-if="session.isGuest" class="guest-note"><strong>게스트 안내</strong><span>게스트는 1인 플레이 게임만 이용할 수 있어요.</span></div>

      <section class="game-section" aria-labelledby="games-title">
        <header class="section-head"><div><span>CHOOSE A GAME</span><h2 id="games-title" :style="{ backgroundImage: `url(${lobbyRoomListBoard})` }"><i>게임 목록</i></h2></div></header>
        <!-- 로딩 중에는 예시 게임이 아니라 빈 자리표시자를 세운다 — 실제 카드와 같은 요소·같은
             높이라 서버 목록이 도착해도 그리드가 밀리지 않는다(SKELETON_CARDS 주석 참고). -->
        <div v-if="gamesLoading" class="game-grid" aria-busy="true">
          <article v-for="n in SKELETON_CARDS" :key="`skeleton-${n}`" class="game-card skeleton" aria-hidden="true">
            <div class="game-visual"></div>
            <div class="game-copy">
              <div class="game-title-row"><h3><span class="sk-bar sk-name" /></h3><span><span class="sk-bar sk-players" /></span></div>
              <p><span class="sk-bar" /><span class="sk-bar sk-short" /></p>
              <div class="game-meta"><span class="sk-chip" /><span class="sk-chip" /></div>
            </div>
          </article>
          <span class="sr-only">게임 목록을 불러오는 중이에요</span>
        </div>

        <!-- 폴백을 없앤 대신 실패를 드러낸다 — 예시 목록으로 덮어 두면 서버가 죽은 것을 아무도 모른다 -->
        <p v-else-if="listError && !games.length" class="list-error">
          <span>{{ listError }}</span>
          <PixelButton @click="reloadGames">다시 시도</PixelButton>
        </p>

        <div v-else class="game-grid">
          <article v-for="game in visibleGames" :key="game.id" class="game-card" :class="{ unavailable: !game.playable }" tabindex="0" @click="openDetail(game)" @keydown.enter="openDetail(game)">
            <div class="game-visual" :class="`tone-${toneFor(game)}`">
              <RhythmThumbnail v-if="isRhythm(game)" />
              <FingerStarThumbnail v-else-if="isFingerStar(game)" />
              <DrawingThumbnail v-else-if="isDrawing(game)" />
              <BodyFitThumbnail v-else-if="isBodyFit(game)" />
              <FishingThumbnail v-else-if="isFishing(game)" />
              <img v-else-if="artFor(game)" :src="artFor(game)" alt="" />
              <button type="button" class="detail-button" :aria-label="`${game.name} 상세 보기`" @click.stop="openDetail(game)"><span>자세히</span><b>›</b></button>
            </div>
            <div class="game-copy"><div class="game-title-row"><h3>{{ game.name }}</h3><span>{{ game.minPlayers }}~{{ game.maxPlayers }}인</span></div><p>{{ game.description }}</p><div class="game-meta"><span>{{ game.mode }}</span><span v-if="game.supportsBot">BOT 가능</span><span v-if="closedByAdmin(game)">점검 중</span><span v-else-if="!game.playable">준비 중</span></div></div>
          </article>
        </div>
      </section>
    </main>

    <PixelModal v-if="detailOpen && detail" variant="lobby" @close="detailOpen = false">
      <section class="game-modal"><span class="modal-eyebrow">GAME GUIDE</span><h3>{{ detail.name }}</h3><!-- 그림 설명이 있는 게임이면 글 대신 그림으로 — 없는 게임은 지금까지대로 서버 글을 쓴다 --><GameGuideCarousel v-if="guidePages" :key="detail.id" :pages="guidePages" /><template v-else><div class="guide-block"><strong>게임 규칙</strong><p>{{ detail.rules }}</p></div><div v-if="detail.controls" class="guide-block"><strong>조작 방법</strong><p>{{ detail.controls }}</p></div></template><!-- 닫힘과 인원 부족을 나눠 안내한다 — 기다릴 일과 친구를 부를 일은 다르다 --><p v-if="selected && closedByAdmin(selected)" class="multi-notice">지금은 점검 중이라 플레이할 수 없어요. 잠시 뒤에 다시 확인해 주세요.</p><p v-else-if="selected?.playable && !soloPlayable" class="multi-notice">이 게임은 {{ selected.minPlayers }}명 이상이 함께 즐길 수 있어요. 로비에서 방을 만들어 친구를 초대해 주세요.</p><div class="modal-actions"><PixelButton block @click="detailOpen = false">닫기</PixelButton><PixelButton v-if="soloPlayable" variant="primary" block :disabled="starting" @click="play">혼자 플레이</PixelButton></div></section>
    </PixelModal>
    <PixelToast :message="toast" />
  </div>
</template>

<style scoped>
.catalog-page { min-height: 100%; color: #3e2e24; }.catalog-shell { max-width: 1460px; margin: 0 auto; padding: 32px clamp(18px, 4vw, 58px) 48px; }.catalog-intro { position: relative; display: flex; min-height: 245px; overflow: hidden; border: 0; border-radius: 17px; background: #c6ecff; box-shadow: none; }.catalog-intro::before { content: ''; position: absolute; inset: 0; background: radial-gradient(rgba(255,255,255,.68) 1px, transparent 1px); background-size: 14px 14px; }.intro-copy { position: relative; z-index: 2; padding: 42px 48px; }.eyebrow, .section-head > div > span, .modal-eyebrow { color: #a8704f; font-size: 10px; font-weight: 700; letter-spacing: 1px; }.intro-copy h1 { margin: 11px 0 9px; font-family: var(--font-pixel); font-size: clamp(30px, 3vw, 43px); font-weight: 400; letter-spacing: -.8px; }.intro-copy > p { margin: 0; color: #685446; font-size: 14px; }.intro-stats { display: flex; gap: 8px; margin-top: 22px; }.intro-stats span { padding: 7px 10px; border: 2px solid #b68d63; border-radius: 6px; background: rgba(255,252,244,.85); color: #755844; font-size: 11px; }.intro-stats b { color: #dc766a; font-size: 15px; }.intro-art { position: absolute; right: 8%; bottom: 0; width: 250px; height: 100%; }.intro-art img { position: absolute; z-index: 2; right: 8px; bottom: -21px; width: 230px; filter: drop-shadow(5px 5px 0 rgba(107,72,48,.18)); }.art-sun { position: absolute; top: 27px; right: 27px; width: 57px; height: 57px; border: 3px solid #ca8d56; border-radius: 50%; background: #ffe69b; }.art-grass { position: absolute; right: 0; bottom: 0; left: -58vw; height: 22px; border-top: 3px solid #669a53; background: repeating-linear-gradient(90deg, #9aca68 0 18px, #b8dc7b 18px 36px); }.guest-note { display: flex; gap: 12px; align-items: center; margin-top: 18px; padding: 12px 15px; border: 2px solid #dfc391; border-radius: 8px; background: #fff3d0; color: #745944; font-size: 12px; }.guest-note strong { color: #a6624b; }.game-section { margin-top: 28px; }.section-head { display: flex; align-items: end; justify-content: space-between; margin: 0 4px 16px; }.section-head h2 { margin: 5px 0 0; font-family: var(--font-pixel); font-size: 26px; font-weight: 400; }.section-head p { margin: 0 0 4px; color: #957e6c; font-size: 12px; }.game-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }.game-card { overflow: hidden; border: 3px solid #d5b98e; border-radius: 12px; background: #fffdf7; box-shadow: 4px 4px 0 #e1ceb0; cursor: pointer; transition: transform .14s ease, box-shadow .14s ease; }.game-card:hover, .game-card:focus-visible { outline: 0; transform: translate(-2px, -2px); box-shadow: 6px 6px 0 #cfb084; }.game-card.unavailable { opacity: .68; filter: saturate(.7); }
/* 로딩 자리표시자 — 실제 카드와 같은 요소를 쓰고 세 줄의 높이만 고정한다.
   높이를 실제와 맞추는 게 요점이다(그래야 목록이 도착할 때 그리드가 밀리지 않는다).
   시각 크기를 지배하는 .game-visual(173px)과 .game-copy 패딩은 실제 카드 규칙을 그대로 쓴다. */
.game-card.skeleton { cursor: default; }.game-card.skeleton:hover { transform: none; box-shadow: 4px 4px 0 #e1ceb0; }.skeleton .game-visual { background: #f2e8d6; }.skeleton .sk-bar, .skeleton .sk-chip { display: block; border-radius: 4px; background: linear-gradient(90deg, #ece1cd 0%, #f8f1e2 50%, #ece1cd 100%); background-size: 220% 100%; animation: sk-shimmer 1.3s ease-in-out infinite; }.skeleton .game-title-row h3 { display: flex; height: 19px; align-items: center; }.skeleton .sk-name { width: 58%; height: 15px; }.skeleton .game-title-row > span { display: flex; height: 19px; align-items: center; }.skeleton .sk-players { width: 38px; height: 10px; }.skeleton .game-copy p { display: flex; flex-direction: column; gap: 6px; }.skeleton .game-copy p .sk-bar { height: 9px; }.skeleton .game-copy p .sk-short { width: 62%; }.skeleton .sk-chip { width: 42px; height: 19px; padding: 0; }
@keyframes sk-shimmer { 0%, 100% { background-position: 220% 0; } 50% { background-position: 0 0; } }
/* 반짝임은 장식이다 — 움직임을 줄여 달라고 한 사용자에게는 정지 상태로 보여 준다 */
@media (prefers-reduced-motion: reduce) { .skeleton .sk-bar, .skeleton .sk-chip { animation: none; } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.list-error { display: flex; gap: 12px; align-items: center; justify-content: center; margin: 0; padding: 20px; border: 2px solid #dcb37d; border-radius: 8px; background: #fff0c9; color: #765c45; font-size: 12px; }.game-visual { position: relative; display: grid; height: 173px; place-items: center; overflow: hidden; border-bottom: 2px solid #d5b98e; }.game-visual::before { content: ''; position: absolute; inset: 0; opacity: .45; background: radial-gradient(rgba(255,255,255,.9) 1px, transparent 1px); background-size: 12px 12px; }.game-visual img { position: relative; z-index: 2; width: 132px; height: 136px; object-fit: contain; transition: transform .15s ease; }.game-card:hover .game-visual img { transform: translateY(-4px) rotate(-2deg); }.tone-sky { background: #c9ebf9; }.tone-mint { background: #d8edcf; }.tone-peach { background: #ffe0c7; }.tone-lilac { background: #e2d9f2; }.tone-butter { background: #ffecad; }.visual-floor { position: absolute; z-index: 1; right: 0; bottom: 0; left: 0; height: 24px; border-top: 2px solid rgba(100,139,73,.5); background: #b8d47a; }.category-tag { position: absolute; z-index: 3; top: 10px; left: 10px; padding: 5px 8px; border: 2px solid #a97756; border-radius: 5px; background: #fffaf0; color: #76523a; font-size: 9px; font-weight: 700; }.detail-button { position: absolute; z-index: 3; right: 10px; bottom: 10px; display: flex; align-items: center; gap: 4px; height: 29px; padding: 0 7px 0 9px; border: 2px solid #986648; border-radius: 5px; background: #fff8e9; color: #704a35; font-size: 9px; font-weight: 700; }.detail-button b { font-size: 17px; line-height: 1; }.game-copy { padding: 16px 16px 14px; }.game-title-row { display: flex; align-items: start; justify-content: space-between; gap: 8px; }.game-title-row h3 { margin: 0; font-size: 16px; }.game-title-row > span { flex: none; color: #907968; font-size: 10px; }.game-copy p { min-height: 31px; margin: 7px 0 11px; color: #816c5b; font-size: 11px; line-height: 1.45; }.game-meta { display: flex; gap: 5px; }.game-meta span { padding: 4px 6px; border-radius: 4px; background: #f4ead5; color: #896b55; font-size: 9px; font-weight: 700; }.game-modal { padding: 2px; }.game-modal h3 { margin: 8px 0 18px; color: #3c2d23; font-family: var(--font-pixel); font-size: 26px; font-weight: 400; }.guide-block { margin-top: 13px; padding: 12px; border: 2px solid #dfc391; border-radius: 7px; background: #fffaf0; }.guide-block strong { color: #875c42; font-size: 11px; }.guide-block p { margin: 6px 0 0; color: #705c4d; font-size: 12px; line-height: 1.6; }.multi-notice { margin: 14px 0 0; padding: 11px; border: 2px solid #dcb37d; border-radius: 7px; background: #fff0c9; color: #765c45; font-size: 11px; line-height: 1.55; }.modal-actions { display: flex; gap: 9px; margin-top: 20px; }.modal-actions > * { flex: 1; }.modal-actions :deep(.px-btn) { border: 2px solid #9a674b; border-radius: 7px; box-shadow: 3px 3px 0 #c6a47d; font-size: 14px; }
.catalog-shell { padding-top: 28px; }.catalog-intro { min-height: 262px; border-radius: 18px; background: #bfe9ff; }.intro-copy { padding: 38px 46px; }.intro-copy h1 { position: relative; z-index: 2; color: #34251f; text-shadow: 2px 2px 0 #f5dbae; }.intro-copy > p { position: relative; z-index: 2; font-size: 13px; }.intro-stats { position: relative; z-index: 3; }.intro-stats span { border-color: #bd8d62; box-shadow: 2px 2px 0 rgba(131,88,57,.18); }.intro-art { right: 8%; width: 310px; }.intro-art img { z-index: 4; right: -14px; bottom: 6px; width: 300px; image-rendering: pixelated; filter: drop-shadow(4px 4px 0 rgba(106,70,42,.18)); }.art-sun { top: 22px; right: 36px; width: 50px; height: 50px; opacity: .9; }.art-grass { right: -13vw; bottom: -8px; left: -72vw; z-index: 3; height: 59px; border: 0; background-repeat: repeat-x; background-position: left bottom; background-size: auto 59px; }.game-section { position: relative; margin-top: 32px; padding: 16px; border: 2px dashed #dec9a7; border-radius: 16px; background: rgba(255,253,247,.62); }.section-head { min-height: 57px; margin: -39px 0 9px -2px; align-items: center; }.section-head > div { display: flex; align-items: center; gap: 11px; }.section-head > div > span { display: none; }.section-head h2 { display: grid; width: 146px; height: 51px; margin: 0; place-items: center; background-position: center; background-repeat: no-repeat; background-size: 100% 100%; color: #33241c; font-size: 18px; }.section-head h2 i { display: block; transform: translateX(3px); font-family: var(--font-pixel); font-style: normal; font-weight: 400; }.section-head p { margin: 9px 8px 0 0; padding: 5px 8px; border-radius: 4px; background: #fff6df; color: #8b725d; }.game-grid { gap: 13px; }.game-card { border: 2px solid #d6ba90; border-radius: 10px; box-shadow: 3px 3px 0 #dfc9a6; }.game-card:hover, .game-card:focus-visible { box-shadow: 5px 5px 0 #c8a77b; }.game-visual { height: 158px; border-bottom-color: #d6ba90; }.game-visual img { width: 126px; height: 126px; }.category-tag { top: 9px; left: 9px; border-color: #b1835f; background: #fff8e9; }.detail-button { border-color: #a37151; box-shadow: 2px 2px 0 rgba(109,67,42,.22); }.game-copy { padding: 14px 14px 13px; }.game-title-row h3 { color: #473125; font-size: 15px; }.game-copy p { min-height: 28px; margin: 6px 0 9px; }.game-meta span { background: #f7ead0; }.guest-note { border-color: #dfc391; box-shadow: 2px 2px 0 rgba(164,119,77,.14); }
.intro-art img { width: 400px; }
.game-meta { display: none; }
@media (max-width: 760px) { .catalog-shell { padding-top: 20px; }.catalog-intro { min-height: 330px; }.intro-copy { padding: 28px 25px; }.intro-copy h1 { max-width: 94%; font-size: 31px; }.intro-copy > p { max-width: 82%; font-size: 12px; }.intro-stats { flex-wrap: wrap; max-width: 74%; }.intro-art { right: -22px; width: 190px; }.intro-art img { width: 185px; }.game-grid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }.section-head h2 { font-size: 23px; } }
</style>
