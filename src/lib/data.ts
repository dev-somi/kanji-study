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

const UPPER = ['중1', '중2', '중3', '고1', '고2', '고3']
/** 1~6 → 초1~초6, 7~12 → 중1~고3 */
export const GRADE_LABEL = (g: number) => (g <= 6 ? `초${g}` : (UPPER[g - 7] ?? '중학 이상'))

/** 검색용: 가타카나 → 히라가나 */
export function kataToHira(s: string) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

// ---------- 구성 요소 ----------
export type PartPosition = 'left' | 'right' | 'top' | 'bottom' | 'middle' | 'tare' | 'nyo' | 'kamae' | 'inside'
export interface KanjiPart {
  e: string // 글자 안에서 띤 자형 (亻)
  o?: string // 변형이면 본래 글자 (人)
  p?: PartPosition
  r?: 1 // 부수
  ph?: 1 // 음 요소
  s: number[] // 획 번호 (1부터)
  c?: KanjiPart[]
}
export interface Radical {
  n: number
  f: string
  ko: string
  ja: string
}
export interface PartsData {
  kanji: Record<string, { rad?: Radical; parts: KanjiPart[] }>
  gloss: Record<string, { ko?: string; en?: string }> // 상용한자 밖 요소
}

let partsPromise: Promise<PartsData> | null = null
export function loadParts(): Promise<PartsData> {
  partsPromise ??= fetch(`${base}data/parts.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`parts.json ${r.status}`)
      return r.json()
    })
    .catch((e) => {
      partsPromise = null
      throw e
    })
  return partsPromise
}

export const POSITION_LABEL: Record<PartPosition, string> = {
  left: '왼쪽',
  right: '오른쪽',
  top: '위',
  bottom: '아래',
  middle: '가운데',
  tare: '위→왼쪽 감쌈',
  nyo: '왼쪽→아래 감쌈',
  kamae: '둘러쌈',
  inside: '안쪽',
}
/** 자리를 가리키는 일본어 용어 (偏과 旁을 합쳐 편방) */
export const POSITION_TERM: Partial<Record<PartPosition, string>> = {
  left: '偏 へん',
  right: '旁 つくり',
  top: '冠 かんむり',
  bottom: '脚 あし',
  tare: '垂 たれ',
  nyo: '繞 にょう',
  kamae: '構 かまえ',
}

// ---------- 예시 단어 ----------
export interface WordsData {
  /** ko: [한글, 한자(한국 정자)], ja: [단어, 읽기, 한국어 뜻] */
  [k: string]: { ko: [string, string][]; ja: [string, string, string][] }
}

let wordsPromise: Promise<WordsData> | null = null
export function loadWords(): Promise<WordsData> {
  wordsPromise ??= fetch(`${base}data/words.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`words.json ${r.status}`)
      return r.json()
    })
    .catch((e) => {
      wordsPromise = null
      throw e
    })
  return wordsPromise
}
