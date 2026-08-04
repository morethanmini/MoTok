/**
 * 번들 채보 — 채보 랩(/dev/chart-lab)의 [게임 번들]로 내보낸 수제 채보를 게임에 싣는다.
 *
 * 자산 규약: `public/assets/charts/<id>/` 아래에
 * - `bundle.json` — 랩이 내보낸 게임 번들(파일명만 bundle.json으로 바꿔서)
 * - 곡 파일 — bundle.json의 `song.file`과 같은 이름 그대로
 *
 * 멀티 동기화: 방장이 songId를 서버에 보내면 서버가 RHYTHM_START로 전원에 중계하고,
 * 각자 이 로더로 같은 정적 자산을 읽는다 — 채보가 고정이라 시드가 필요 없다.
 */

import { parseBeatmap, type Beatmap } from '../core/beatmap'
import type { RingBeatmap } from '../ring/ringLogic'

export interface BundledSongEntry {
  /** 서버로 전달되는 id이자 자산 폴더명 — 소문자·숫자·하이픈만 */
  id: string
  label: string
}

/** 방 시작 UI에 노출되는 곡 목록 — 자산을 추가하면 여기 한 줄 늘리면 된다 */
export const BUNDLED_SONGS: BundledSongEntry[] = [
  { id: 'ssafy-fighting-manual', label: 'SSAFY Fighting · MANUAL' },
  { id: 'ssafy-fighting-manual-verse1', label: 'SSAFY Fighting · MANUAL (1절)' },
  { id: 'ssafy-fighting-extreme', label: 'SSAFY Fighting · EXTREME' },
]

export interface LoadedBundle {
  difficulty: string
  catch: Beatmap
  ring: RingBeatmap & { durationMs: number }
  song: { src: string; gridOriginMs: number; startMs: number }
  /** 라운드 길이 산정용 — 두 모드 채보 중 긴 쪽 */
  durationMs: number
}

const cache = new Map<string, Promise<LoadedBundle>>()

export function loadBundledChart(id: string): Promise<LoadedBundle> {
  let hit = cache.get(id)
  if (!hit) {
    hit = fetchBundle(id)
    // 실패는 캐시하지 않는다 — 자산을 올린 뒤 재시도할 수 있게
    hit.catch(() => cache.delete(id))
    cache.set(id, hit)
  }
  return hit
}

async function fetchBundle(id: string): Promise<LoadedBundle> {
  const dir = `/assets/charts/${id}`
  const res = await fetch(`${dir}/bundle.json`)
  if (!res.ok) throw new Error(`번들 채보를 찾을 수 없어요: ${id}`)
  const json = (await res.json()) as {
    song?: { file?: string; gridOriginMs?: number; startMs?: number }
    difficulty?: string
    catch?: unknown
    ring?: { approachTimeMs?: number; notes?: RingBeatmap['notes'] }
  }
  const song = json.song
  if (!song?.file || typeof song.gridOriginMs !== 'number' || typeof song.startMs !== 'number') {
    throw new Error(`번들에 곡 정보가 없어요: ${id}`)
  }
  const catchChart = parseBeatmap(json.catch) // 스키마 검증을 겸한다
  const ringNotes = json.ring?.notes
  if (!Array.isArray(ringNotes) || ringNotes.length === 0) {
    throw new Error(`번들에 링 채보가 없어요: ${id}`)
  }
  const ringDurationMs = ringNotes.reduce((m, n) => Math.max(m, n.timeMs + (n.durationMs ?? 0)), 0)
  return {
    difficulty: json.difficulty ?? 'MANUAL',
    catch: catchChart,
    ring: { approachTimeMs: json.ring?.approachTimeMs ?? 1200, notes: ringNotes, durationMs: ringDurationMs },
    song: { src: `${dir}/${song.file}`, gridOriginMs: song.gridOriginMs, startMs: song.startMs },
    durationMs: Math.max(catchChart.durationMs, ringDurationMs),
  }
}
