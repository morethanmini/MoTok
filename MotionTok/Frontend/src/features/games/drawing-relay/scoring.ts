/**
 * 그림으로 말해요 — GMS AI 채점 클라이언트.
 *
 * 완성 그림(PNG data URL)을 비전 모델에 보내 "무엇을 그린 것인지" 5개 추측을 받는다.
 * 주제어는 프롬프트에 절대 넣지 않는다 — 블라인드 채점이 게임의 핵심 규칙.
 *
 * VITE_GMS_KEY 미설정 시 모의 채점으로 폴백해 로컬에서 채점 UI까지 테스트할 수 있다.
 * 주의: VITE_* 값은 번들에 노출되는 공개값 — 키 직접 호출은 로컬 테스트 전용이며,
 * 배포 시에는 백엔드 프록시 엔드포인트로 옮겨야 한다.
 */
import { parseGuesses } from './logic'
import { DRAW_TOPICS } from './words'

/**
 * GMS 릴레이 기본 주소 — OpenAI 호환(chat/completions) 엔드포인트.
 * GMS는 CORS preflight를 허용하지 않아 브라우저에서 직접 부르면 "Failed to fetch"가 난다.
 * 상대 경로로 두고 Vite dev 프록시(vite.config.ts의 /gmsapi → gms.ssafy.io)를 태운다.
 */
const DEFAULT_GMS_API_URL = '/gmsapi/api.openai.com/v1/chat/completions'
const DEFAULT_GMS_MODEL = 'gpt-4o'

/** 사용자 확정 프롬프트 + 파싱용 형식 지시(주제어 미포함) */
const JUDGE_PROMPT =
  '이 그림이 무엇을 그린 것인지 가능성 높은 순으로 5개 추측해줘. ' +
  '각 추측은 한국어 명사 한 단어로만 하고, 다른 설명 없이 JSON 배열로만 답해줘. ' +
  '예시: ["사과","수박","공","달","바퀴"]'

export interface JudgeResult {
  /** 가능성 높은 순 추측 5개 */
  guesses: string[]
  /** gms = 실제 AI 채점, mock = 키 미설정 로컬 모의 채점 */
  source: 'gms' | 'mock'
}

/**
 * 그림 채점 — GMS 키가 있으면 실제 호출, 없으면 모의 채점.
 * @param imageDataUrl 완성 그림 PNG data URL
 * @param mockAnswer   모의 채점 전용 — 정답 노출 확률을 섞기 위한 주제어(GMS 경로에는 절대 전달되지 않음)
 */
export async function judgeDrawing(imageDataUrl: string, mockAnswer?: string): Promise<JudgeResult> {
  const key = import.meta.env.VITE_GMS_KEY
  if (!key) return mockJudge(mockAnswer)

  const url = import.meta.env.VITE_GMS_API_URL || DEFAULT_GMS_API_URL
  const model = import.meta.env.VITE_GMS_MODEL || DEFAULT_GMS_MODEL
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: JUDGE_PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`GMS 채점 요청 실패 (${res.status})`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content ?? ''
  const guesses = parseGuesses(text)
  if (guesses.length === 0) throw new Error('GMS 응답에서 추측을 읽지 못했어요')
  return { guesses, source: 'gms' }
}

/** 모의 채점 — 오답 4~5개 사이에 70% 확률로 정답을 무작위 순위로 끼워 넣는다 */
async function mockJudge(answer?: string): Promise<JudgeResult> {
  await new Promise((r) => setTimeout(r, 900)) // 실제 호출 체감 재현
  const decoys = DRAW_TOPICS.filter((w) => w !== answer).sort(() => Math.random() - 0.5)
  const guesses = decoys.slice(0, 5)
  if (answer && Math.random() < 0.7) {
    guesses.splice(Math.floor(Math.random() * 5), 1, answer)
  }
  return { guesses, source: 'mock' }
}
