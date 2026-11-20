import type { KanjiEntry } from './types'

const base = import.meta.env.BASE_URL

let kanjiPromise: Promise<KanjiEntry[]> | null = null
export function loadKanji(): Promise<KanjiEntry[]> {
  kanjiPromise ??= fetch(`${base}data/kanji.json`).then((r) => {
    if (!r.ok) throw new Error(`kanji.json ${r.status}`)
    return r.json()
  })
  return kanjiPromise
}

let strokesPromise: Promise<Record<string, string[]>> | null = null
/** 획순 데이터 (약 1.9MB) — 처음 필요할 때 한 번만 받는다. 이후엔 서비스워커 캐시 */
export function loadStrokes(): Promise<Record<string, string[]>> {
  strokesPromise ??= fetch(`${base}data/strokes.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`strokes.json ${r.status}`)
      return r.json()
    })
    .catch((e) => {
      strokesPromise = null
      throw e
    })
  return strokesPromise
}

/** 훈독 표기 'まな-ぶ' → { stem: 'まな', okuri: 'ぶ' }, 접두/접미형 '-' 처리 */
export function splitKun(r: string): { stem: string; okuri: string } {
  const i = r.indexOf('-')
  if (i <= 0) return { stem: r.replace(/-/g, ''), okuri: '' }
  return { stem: r.slice(0, i), okuri: r.slice(i + 1) }
}

export const GRADE_LABEL = (g: number) => (g <= 6 ? `${g}학년` : '중학 이상')

/** 검색용: 가타카나 → 히라가나 */
export function kataToHira(s: string) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}
