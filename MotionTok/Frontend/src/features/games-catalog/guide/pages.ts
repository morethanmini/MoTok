/**
 * 게임별 그림 설명 페이지.
 *
 * 여기 등록된 게임만 설명 모달에 캐러셀이 뜨고, 나머지는 기존 서버 글(rules/controls)을
 * 그대로 보여준다 — 게임이 늘 때마다 그림을 다 그릴 수는 없으니 둘이 공존해야 한다.
 *
 * 문장 규칙: 한 장에 한 문장, 어린아이가 읽을 수 있는 말로. 조건·예외·점수 공식은
 * 넣지 않는다(그건 그림으로도 글로도 안 읽힌다). 한 문장이 길어지면 줄이지 말고 장을 나눈다.
 *
 * ⚠️ 키는 백엔드 games 테이블의 id다 — GamesCatalogView의 FINGER_STAR_GAME_ID 등과 같은 값.
 * 여기 한 줄만 등록하면 로비 게임 목록과 방 안 선택창 양쪽에 함께 반영된다(둘 다 이 표를 본다).
 */
import { h, type Component } from 'vue'
import StepBadge from './StepBadge.vue'
import Step1Camera from './finger-star/Step1Camera.vue'
import Step2Stars from './finger-star/Step2Stars.vue'
import Step3Touch from './finger-star/Step3Touch.vue'
import Step4Hold from './finger-star/Step4Hold.vue'
import Step5Win from './finger-star/Step5Win.vue'
import Step1Together from './drawing/Step1Together.vue'
import Step2Topic from './drawing/Step2Topic.vue'
import Step3Turn from './drawing/Step3Turn.vue'
import Step4Pinch from './drawing/Step4Pinch.vue'
import Step5Erase from './drawing/Step5Erase.vue'
import Step6Ai from './drawing/Step6Ai.vue'
import RhHands from './rhythm/Step1Hands.vue'
import RhNotes from './rhythm/Step2Notes.vue'
import RhTouch from './rhythm/Step3Touch.vue'
import RhColors from './rhythm/Step4Colors.vue'
import RhTrail from './rhythm/Step5Trail.vue'
import RhPerfect from './rhythm/Step6Perfect.vue'
import BfMirror from './bodyfit/Step1Mirror.vue'
import BfSetter from './bodyfit/Step2Setter.vue'
import BfHole from './bodyfit/Step3Hole.vue'
import BfComing from './bodyfit/Step4Coming.vue'
import BfMatch from './bodyfit/Step5Match.vue'
import BfPass from './bodyfit/Step6Pass.vue'
import BfFail from './bodyfit/Step7Fail.vue'
import FiGrip from './fishing/Step1Grip.vue'
import FiAim from './fishing/Step2Aim.vue'
import FiCast from './fishing/Step3Cast.vue'
import FiDepth from './fishing/Step4Depth.vue'
import FiDeep from './fishing/Step5Deep.vue'
import FiHook from './fishing/Step6Hook.vue'
import FiReel from './fishing/Step7Reel.vue'

export interface GuidePage {
  /** 그림 한 장을 설명하는 한 문장. */
  caption: string
  /** 320x220 viewBox svg 하나를 그리는 컴포넌트. */
  art: Component
}

const FINGER_STAR: GuidePage[] = [
  { caption: '카메라 앞에서 두 손을 쫙 펴요.', art: Step1Camera },
  { caption: '밤하늘에 별 그림이 나타나요.', art: Step2Stars },
  { caption: '손가락 끝으로 별을 하나씩 짚어요.', art: Step3Touch },
  { caption: '게이지를 모두 채울 때까지 가만히!', art: Step4Hold },
  { caption: '60초 동안 많이 만들면 이겨요.', art: Step5Win },
]

/**
 * 그림으로 말해요.
 * 손동작이 두 가지(집기·주먹)라 한 장에 몰지 않고 나눴다 — 둘을 한 문장에 넣으면
 * "오른손 엄지검지를 집으면 그리기, 왼손 주먹으로 문지르면 지우개"가 되어 아이가 못 읽는다.
 * 인원(3명부터)·시간(90초)·순위별 점수는 넣지 않는다. 그건 해 보면 알게 되는 값이고,
 * 여기서 알아야 하는 건 "무엇을 하는 게임인가"다.
 */
const DRAWING: GuidePage[] = [
  { caption: '친구들과 그림 하나를 같이 그려요.', art: Step1Together },
  { caption: '무엇을 그릴지 주제가 나와요.', art: Step2Topic },
  { caption: '내 차례가 오면 이어서 그려요.', art: Step3Turn },
  { caption: '오른손을 OK 모양으로 만들어요.', art: Step4Pinch },
  { caption: '왼손 주먹으로 문지르면 지워져요.', art: Step5Erase },
  { caption: '다 그리면 AI가 무엇인지 맞혀요!', art: Step6Ai },
]

/**
 * 캐치캐치리듬.
 * ⚠️ "주먹을 쥐어서 잡는다"는 <b>넣지 않았다</b> — 화면 안내와 백엔드 시더 문구에 남아 있지만
 * 주먹 음표는 모든 난이도에서 생성 확률이 0이라 실제로는 나오지 않는다(rhythm/art.ts 주석).
 * 링 모드는 다루지 않는다. 기본 모드인 '캐치' 하나만 알면 들어가서 나머지는 보고 안다.
 */
const RHYTHM: GuidePage[] = [
  { caption: '두 손을 펴서 카메라에 보여 줘요.', art: RhHands },
  { caption: '발바닥 음표가 하나씩 나와요.', art: RhNotes },
  { caption: '동그라미가 딱 겹칠 때 손을 대요.', art: RhTouch },
  { caption: '파란 건 왼손, 빨간 건 오른손이에요.', art: RhColors },
  { caption: '길게 이어진 음표는 손으로 따라가요.', art: RhTrail },
  { caption: '잘 맞히면 PERFECT, 점수가 쌓여요!', art: RhPerfect },
]

/**
 * 몸 끼워 맞추기.
 * 출제 대결(한 사람이 포즈를 내는 모드)을 기준으로 그렸다 — 연속 서바이벌도 "구멍에
 * 몸을 맞춘다"는 핵심은 같고, 다른 건 누가 포즈를 정하느냐뿐이라 그림이 그대로 통한다.
 *
 * 실패(걸림)를 먼저, 성공(통과)을 마지막에 둔다 — 마지막 장이 그 게임의 인상으로 남으니
 * "이렇게 하면 된다"로 끝나야 한다.
 */
const BODY_FIT: GuidePage[] = [
  { caption: '카메라 앞에 서면 인형이 나를 따라 해요.', art: BfMirror },
  { caption: '한 친구가 포즈를 정해요.', art: BfSetter },
  { caption: '그 포즈가 벽에 구멍으로 뚫려요.', art: BfHole },
  { caption: '벽이 점점 가까이 다가와요.', art: BfComing },
  { caption: '구멍과 똑같은 포즈를 만들어요.', art: BfMatch },
  { caption: '삐져나온 곳은 벽에 걸려요.', art: BfFail },
  { caption: '몸이 쏙 들어가면 통과!', art: BfPass },
]

/**
 * 모션 낚시.
 * 동작이 여섯 개(쥐기·조준·던지기·깊이·챔질·감기)라 한 장에 둘씩 묶으면 아이가 못 읽는다.
 * 어종 이름은 넣지 않았다 — 15종을 외우게 할 이유가 없고, 알아야 하는 건 "점수가 다르다"뿐이다.
 */
const FISHING: GuidePage[] = [
  { caption: '두 손으로 낚싯대를 잡아요.', art: FiGrip },
  { caption: '손을 좌우로 움직여 던질 곳을 골라요.', art: FiAim },
  { caption: '손을 앞으로 내밀면 던져져요.', art: FiCast },
  { caption: '손 높이로 미끼 깊이를 정해요.', art: FiDepth },
  { caption: '물고기마다 점수가 달라요.', art: FiDeep },
  { caption: '입질이 오면 두 손을 위로 번쩍!', art: FiHook },
  { caption: '한 손을 고정하고 다른 손으로 줄을 감아요.', art: FiReel },
]

const GUIDE_PAGES: Record<number, GuidePage[]> = {
  1: FINGER_STAR,
  2: RHYTHM,
  4: BODY_FIT,
  10: DRAWING,
  11: FISHING,
}

export function guidePagesFor(gameId: number): GuidePage[] | null {
  return GUIDE_PAGES[gameId] ?? null
}

/**
 * 그림이 없는 게임의 대체 페이지 — 갖고 있는 문장들을 한 장에 하나씩 얹는다.
 *
 * <p>방 안 "설명 함께 보기"는 <b>모든 게임</b>에서 눌려야 한다. 그림이 그려진 게임에서만
 * 되면 방장은 왜 어떤 게임엔 버튼이 없는지 알 수 없다. 그림이 붙는 대로 이 대체는
 * {@link guidePagesFor}에 밀려난다 — 등록만 하면 저절로 그림 쪽이 쓰인다.</p>
 */
export function fallbackGuidePages(emoji: string, paragraphs: string[]): GuidePage[] {
  const used = paragraphs
    .flatMap(splitSentences)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_FALLBACK_PAGES)
  return used.map((caption, i) => ({
    caption,
    art: () => h(StepBadge, { emoji, step: i + 1 }),
  }))
}

/** 대체 페이지 상한 — 넘기다 지치면 아무도 끝까지 안 본다. 그림 5장 기준에 맞춘다. */
const MAX_FALLBACK_PAGES = 6

/**
 * 문단을 문장 단위로 쪼갠다 — "한 장에 한 문장" 규칙을 기존 설명글에도 적용하기 위한 것.
 * 마침표·물음표·느낌표 뒤 공백에서만 끊으므로 "1분 30초"의 소수점 같은 건 붙어 있는다.
 */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/)
}

/** 그림이 있으면 그림, 없으면 문장 페이지 — 호출부가 둘을 구분하지 않아도 되게. */
export function guidePagesOrFallback(
  gameId: number,
  emoji: string,
  sentences: string[],
): GuidePage[] {
  return guidePagesFor(gameId) ?? fallbackGuidePages(emoji, sentences)
}
