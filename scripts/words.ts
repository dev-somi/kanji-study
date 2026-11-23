/**
 * 예시 단어 (scripts/words/*.tsv) 읽기와 검증.
 *  ko-*.tsv : 한자 \t 한글 \t 한자표기(한국 정자)      예) 学	학교	學校
 *  ja-*.tsv : 한자 \t 단어 \t 읽기(히라가나) \t 한국어 뜻  예) 学	学校	がっこう	학교
 * 검증
 *  - 한국어: 한자표기에 대상 글자가 들어 있는지, 한글 음절이 각 한자의 음과 맞는지 (두음법칙 허용)
 *  - 일본어: 단어에 대상 글자가 들어 있는지, JMdict에 (단어, 읽기) 쌍이 있는지, 흔히 쓰는 말(common)인지
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type KoWord = [hangul: string, hanja: string]
export type JaWord = [word: string, reading: string, meaning: string]

/** 두음법칙: 첫소리 ㄹ→ㄴ/ㅇ, ㄴ→ㅇ */
export function initialLaw(syl: string): string {
  const code = syl.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return syl
  const cho = Math.floor(code / 588)
  const jung = Math.floor((code % 588) / 28)
  const jong = code % 28
  // ㅑ ㅕ ㅖ ㅛ ㅠ ㅣ 앞에서는 ㅇ, 그 외 ㄹ→ㄴ
  const iotized = [2, 6, 7, 12, 17, 20].includes(jung)
  let newCho = cho
  if (cho === 5) newCho = iotized ? 11 : 2 // ㄹ
  else if (cho === 2 && iotized) newCho = 11 // ㄴ
  return String.fromCharCode(0xac00 + newCho * 588 + jung * 28 + jong)
}

/** 훈음 "배울 학", "어찌 나, 어찌 내" → 음 음절 목록 */
export function soundsOfKo(ko: string): string[] {
  return ko
    .replace(/\[[^\]]*\]/g, '')
    .split(/[,/]/)
    .map((p) => p.trim().split(/\s+/).pop()!)
    .filter(Boolean)
}

/** 사이시옷: 숫(數)·곳(庫)·셋(貰)·횟(回)·찻(車)·툇(退) → ㅅ 받침을 뗀 음절 */
function dropSaisiot(syl: string): string | undefined {
  const code = syl.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171 || code % 28 !== 19) return undefined
  return String.fromCharCode(0xac00 + code - 19)
}

/** 음절 s가 음 목록 중 하나와 맞는지 (두음법칙, 모음·ㄴ 뒤 렬/률→열/율, 사이시옷 포함) */
export function soundMatches(s: string, sounds: Iterable<string>): boolean {
  const bare = dropSaisiot(s)
  for (const x of sounds) if (x === s || initialLaw(x) === s || x === bare) return true
  return false
}

/** 속음(활음조 등)으로 한자 본음과 다르게 읽는 단어 */
const SOUND_EXCEPTIONS = new Set(['곤란', '폐렴', '허락', '대로', '유월', '시월', '모란', '오륙도', '희로애락', '보리', '도량', '맹세'])

/** 한국어 예시 한 줄 검증. 문제가 없으면 undefined */
export function checkKo(
  targets: string[],
  [hangul, hanja]: KoWord,
  soundsOf: (c: string) => string[],
): string | undefined {
  const hs = [...hangul]
  const cs = [...hanja]
  if (!cs.some((c) => targets.includes(c))) return '대상 글자 없음'
  if (hs.length !== cs.length) return `글자 수 다름 (${hs.length}≠${cs.length})`
  if (SOUND_EXCEPTIONS.has(hangul)) return undefined
  const bad: string[] = []
  cs.forEach((c, i) => {
    const sounds = soundsOf(c)
    if (!sounds.length) return // 음을 모르는 글자는 넘어감
    if (!soundMatches(hs[i], sounds)) bad.push(`${c}=${hs[i]}? (${sounds.join(',')})`)
  })
  return bad.length ? `음 불일치 ${bad.join(' ')}` : undefined
}

/** JMdict(jmdict-simplified) 단어 → 읽기 목록, 흔히 쓰는지 */
export interface JmIndex {
  get(word: string): { readings: Map<string, boolean> } | undefined
}

interface JmWord {
  kanji: { text: string; common: boolean }[]
  kana: { text: string; common: boolean; appliesToKanji: string[] }[]
}

export function loadJmdict(file: string): JmIndex {
  const data: { words: JmWord[] } = JSON.parse(readFileSync(file, 'utf8'))
  const map = new Map<string, { readings: Map<string, boolean> }>()
  for (const w of data.words) {
    const forms = w.kanji.length ? w.kanji : w.kana.map((k) => ({ text: k.text, common: k.common }))
    for (const f of forms) {
      let e = map.get(f.text)
      if (!e) map.set(f.text, (e = { readings: new Map() }))
      for (const r of w.kana) {
        if (w.kanji.length && !r.appliesToKanji.includes('*') && !r.appliesToKanji.includes(f.text)) continue
        const common = f.common || r.common
        e.readings.set(r.text, (e.readings.get(r.text) ?? false) || common)
      }
    }
  }
  return map
}

export function katakanaToHiragana(s: string) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

/** 일본어 예시 한 줄 검증. 문제 없으면 undefined, 흔하지 않은 말이면 경고 */
export function checkJa(
  targets: string[],
  [word, reading]: JaWord,
  jm?: JmIndex,
): { error?: string; warn?: string } {
  if (![...word].some((c) => targets.includes(c))) return { error: '대상 글자 없음' }
  if (!/^[ぁ-ゖー]+$/.test(reading)) return { error: `읽기는 히라가나로 (${reading})` }
  if (!jm) return {}
  const e = jm.get(word)
  if (!e) return { error: 'JMdict에 없는 단어' }
  const rs = new Map([...e.readings].map(([r, c]) => [katakanaToHiragana(r), c]))
  if (!rs.has(reading)) return { error: `읽기 다름 (JMdict: ${[...rs.keys()].join(',')})` }
  if (!rs.get(reading)) return { warn: '흔하지 않은 말' }
  return {}
}

/** scripts/words/{prefix}-*.tsv 를 한자별로 모음 (# 줄과 빈 줄 무시) */
export function loadWordFiles(dir: string, prefix: 'ko' | 'ja'): Map<string, string[][]> {
  const map = new Map<string, string[][]>()
  if (!existsSync(dir)) return map
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.tsv')).sort()) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue
      const [k, ...rest] = line.split('\t').map((s) => s.trim())
      if (!k || rest.some((x) => !x)) continue
      const list = map.get(k) ?? []
      list.push(rest)
      map.set(k, list)
    }
  }
  return map
}
