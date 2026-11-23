/**
 * 데이터 빌드 스크립트
 *  입력 (data-src/, git 미포함 — scripts/fetch-sources.sh 로 내려받음)
 *   - wiki/joyo.json        : ja.wikipedia「常用漢字一覧」wikitext (CC BY-SA) → 상용한자 목록, 공식 음훈, 旧字体, 학년
 *   - kanjidic/kanjidic2.xml: KANJIDIC2 (EDRDG, CC BY-SA) → 빈도, 한국 음(검증용), 영어 뜻
 *   - kanjivg/kanji/*.svg   : KanjiVG (CC BY-SA) → 획순 path
 *   - scripts/korean/*.tsv  : 한국어 훈음 (한자\t훈음)
 *   - scripts/data/kanken.tsv: 중학 이상 한자의 漢検 급수 (Kanjium, CC BY-SA) → 중1~고3
 *  출력
 *   - public/data/kanji.json
 *   - public/data/strokes.json
 *   - public/data/parts.json   : 구성 요소 트리 + 부수 + 상용한자 밖 요소의 음·뜻
 *   - public/data/words.json   : 한국어·일본어 예시 단어 (scripts/words/*.tsv, JMdict로 검증)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { collectElements, loadRadicals, parseParts, resolveRadical, type PartOut, type RadicalOut } from './structure'
import { checkJa, checkKo, initialLaw, loadJmdict, loadWordFiles, soundsOfKo, type JaWord, type KoWord } from './words'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'data-src')
const OUT = join(ROOT, 'public', 'data')

export interface KanjiEntry {
  id: number // 학습 순서 (0부터)
  k: string // 신자체
  old?: string // 旧字体 (한국 정자와 대부분 일치)
  g: number // 학년 1~6 = 초1~초6, 7~12 = 중1~고3 (漢検 급수로 나눔)
  s: number // 총획수
  on: string[] // 음독 (가타카나)
  kun: string[] // 훈독 (히라가나, 送り仮名는 '-' 뒤)
  sp: string[] // 특별/드문 읽기 (표에서 괄호로 표시된 것)
  ko: string // 한국어 훈음 (예: "배울 학")
  en: string // 영어 뜻 (참고)
}

// ---------- 1. Wikipedia 상용한자표 ----------
function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
}

function cleanCell(s: string) {
  return decodeEntities(
    s
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<ref[^>]*\/>/g, '')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
      .replace(/<span style="display:none">[^<]*<\/span>/g, ''),
  )
}

/**
 * 셀 안의 [[wikt:X|Y]] 링크에서 글자를 꺼냄.
 *  - 기본은 링크 대상 X (표시부 Y에는 <span> 등이 끼어 있을 수 있음)
 *  - 旧字体 칸은 표시부가 호환 한자(&#xFA17; 등)인 경우가 있어 표시부를 우선, NFC 정규화
 *  - 「𠮟-叱」처럼 링크가 둘이면 마지막 것(일반 폰트·IME에서 쓰는 글자)을 사용
 */
function linkChar(cell: string, preferDisplay = false): string | undefined {
  const all = [...cell.matchAll(/\[\[wikt:([^|\]]+)\|([^\]]+)\]\]/g)]
  const m = all.at(-1)
  if (!m) return undefined
  const display = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim()
  const src = preferDisplay && [...display].length === 1 ? display : m[1]
  return [...src.normalize('NFC')][0]
}

interface WikiRow {
  k: string
  old?: string
  g: number
  s: number
  on: string[]
  kun: string[]
  sp: string[]
}

function parseWiki(): WikiRow[] {
  const wikitext: string = JSON.parse(readFileSync(join(SRC, 'wiki', 'joyo.json'), 'utf8')).parse.wikitext
  const rows: WikiRow[] = []
  for (const raw of wikitext.split(/\n\|-[^\n]*/)) {
    const r = raw.trim()
    if (!r.startsWith('|') || r.startsWith('|}')) continue
    // 셀 구분자 '||' — 단, 셀 내부의 [[a|b]] 파이프는 단일 '|' 라 안전
    const cells = r.slice(1).split('||')
    if (cells.length < 9) continue
    const num = cleanCell(cells[0]).replace(/\{\{0[^}]*\}\}/g, '').trim()
    if (!/^\d+$/.test(num)) continue
    const removed = cleanCell(cells[7]).trim()
    if (removed) continue // 삭제된 글자 (2010년 개정에서 제외)
    const k = linkChar(cells[1])
    if (!k) throw new Error(`kanji not found in row ${num}`)
    const oldC = linkChar(cells[2], true)
    const s = parseInt(cleanCell(cells[4]).trim(), 10)
    const gradeRaw = cleanCell(cells[5]).trim()
    const g = /^[1-6]$/.test(gradeRaw) ? parseInt(gradeRaw, 10) : 7
    const readingText = cleanCell(cells[8])
      .replace(/<[^>]+>/g, '')
      .replace(/\{\{[^}]*\}\}/g, '')
      .trim()
    const on: string[] = []
    const kun: string[] = []
    const sp: string[] = []
    for (let part of readingText.split(/[、,]/)) {
      part = part.trim()
      if (!part) continue
      const special = /^[（(].*[）)]$/.test(part)
      const reading = part.replace(/[（）()]/g, '').trim()
      if (special) sp.push(reading)
      else if (/^[゠-ヿ]/.test(reading)) on.push(reading)
      else kun.push(reading)
    }
    // 읽기가 전부 괄호(1자 내림)인 글자는 그것이 유일한 읽기 → 일반 읽기로 취급
    if (!on.length && !kun.length) {
      for (const r of sp.splice(0)) (/^[\u30A0-\u30FF]/.test(r) ? on : kun).push(r)
    }
    rows.push({ k, old: oldC && oldC !== k ? oldC : undefined, g, s, on, kun, sp })
  }
  return rows
}

// ---------- 2. KANJIDIC2 ----------
interface DicInfo {
  freq?: number
  ko: string[]
  en: string[]
  rad?: number // 강희 부수 번호
}
function parseKanjidic(): Map<string, DicInfo> {
  const xml = readFileSync(join(SRC, 'kanjidic', 'kanjidic2.xml'), 'utf8')
  const map = new Map<string, DicInfo>()
  for (const block of xml.split('<character>').slice(1)) {
    const lit = block.match(/<literal>(.+?)<\/literal>/)?.[1]
    if (!lit) continue
    const freq = block.match(/<freq>(\d+)<\/freq>/)?.[1]
    const ko = [...block.matchAll(/<reading r_type="korean_h">(.+?)<\/reading>/g)].map((m) => m[1])
    const en = [...block.matchAll(/<meaning>(.+?)<\/meaning>/g)].map((m) => m[1])
    const rad = block.match(/<rad_value rad_type="classical">(\d+)<\/rad_value>/)?.[1]
    map.set(lit, { freq: freq ? parseInt(freq, 10) : undefined, ko, en, rad: rad ? parseInt(rad, 10) : undefined })
  }
  return map
}

// ---------- 3. KanjiVG ----------
function strokesFor(k: string): string[] | undefined {
  const cp = k.codePointAt(0)!.toString(16).padStart(5, '0')
  const file = join(SRC, 'kanjivg', 'kanji', `${cp}.svg`)
  if (!existsSync(file)) return undefined
  const svg = readFileSync(file, 'utf8')
  return [...svg.matchAll(/<path [^>]*\bd="([^"]+)"/g)].map((m) => m[1])
}

// ---------- 4. 한국어 훈음 ----------
function loadKorean(): Map<string, string> {
  const dir = join(ROOT, 'scripts', 'korean')
  const map = new Map<string, string>()
  if (!existsSync(dir)) return map
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.tsv')).sort()) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      const [k, ko] = line.split('\t')
      if (k && ko) map.set(k.trim(), ko.trim())
    }
  }
  return map
}

// ---------- main ----------
function main() {
  const wiki = parseWiki()
  const dic = parseKanjidic()
  const korean = loadKorean()
  const radicals = loadRadicals(ROOT)
  const partsOut: Record<string, { rad?: RadicalOut; parts: PartOut[] }> = {}
  const elements = new Set<string>()

  assignUpperGrades(wiki, dic)

  // 학년 → 같은 학년 안에서는 빈도순 (빈도 없으면 뒤로)
  const sorted = [...wiki].sort((a, b) => {
    if (a.g !== b.g) return a.g - b.g
    const fa = dic.get(a.k)?.freq ?? 9999
    const fb = dic.get(b.k)?.freq ?? 9999
    return fa - fb
  })

  const entries: KanjiEntry[] = []
  const strokes: Record<string, string[]> = {}
  const problems: string[] = []

  sorted.forEach((w, id) => {
    const d = dic.get(w.k) ?? (w.old ? dic.get(w.old) : undefined)
    const ko = korean.get(w.k) ?? ''
    if (!ko) problems.push(`훈음 없음: ${w.k}`)
    else {
      // 훈음의 마지막 음절(음)이 KANJIDIC 한국 음과 맞는지 확인 (신자체·구자체 모두 허용)
      const sounds = new Set([...(dic.get(w.k)?.ko ?? []), ...(w.old ? (dic.get(w.old)?.ko ?? []) : [])])
      const syllables = ko
        .replace(/\[[^\]]*\]/g, '')
        .split(/[,/]/)
        .map((p) => p.trim().split(/\s+/).pop()!)
        .filter(Boolean)
      // 두음법칙(녀→여, 력→역 등)도 허용
      const ok = syllables.some((s) => sounds.has(s) || [...sounds].some((x) => initialLaw(x) === s))
      // 한국 관용음이 KANJIDIC과 다른 글자 (唇: 한국에서는 脣과 같은 '순')
      const KNOWN_EXCEPTIONS = new Set(['唇'])
      if (sounds.size && !ok && !KNOWN_EXCEPTIONS.has(w.k)) problems.push(`음 불일치: ${w.k} "${ko}" (KANJIDIC: ${[...sounds].join(',')})`)
    }
    const svgFile = join(SRC, 'kanjivg', 'kanji', `${w.k.codePointAt(0)!.toString(16).padStart(5, '0')}.svg`)
    if (existsSync(svgFile)) {
      const parts = parseParts(readFileSync(svgFile, 'utf8'))
      const radNo = dic.get(w.k)?.rad ?? (w.old ? dic.get(w.old)?.rad : undefined)
      const rad = radNo ? resolveRadical(radNo, parts, radicals) : undefined
      partsOut[w.k] = { ...(rad ? { rad } : {}), parts }
      collectElements(parts).forEach((e) => elements.add(e))
    }
    const st = strokesFor(w.k)
    if (!st) problems.push(`획순 없음: ${w.k}`)
    else {
      strokes[w.k] = st
      if (st.length !== w.s) problems.push(`획수 차이: ${w.k} 표=${w.s} KanjiVG=${st.length}`)
    }
    entries.push({
      id,
      k: w.k,
      ...(w.old ? { old: w.old } : {}),
      g: w.g,
      s: w.s,
      on: w.on,
      kun: w.kun,
      sp: w.sp,
      ko,
      en: (d?.en ?? []).slice(0, 3).join(', '),
    })
  })

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'kanji.json'), JSON.stringify(entries))
  writeFileSync(join(OUT, 'strokes.json'), JSON.stringify(strokes))

  // 상용한자가 아닌 구성 요소(乡, 艮 …)의 한국 음과 영어 뜻 — 상용한자는 앱이 훈음을 직접 씀
  const joyo = new Set(entries.map((e) => e.k))
  const gloss: Record<string, { ko?: string; en?: string }> = {}
  for (const el of elements) {
    if (joyo.has(el)) continue
    const d = dic.get(el)
    if (!d) continue
    gloss[el] = { ...(d.ko[0] ? { ko: d.ko[0] } : {}), ...(d.en[0] ? { en: d.en[0] } : {}) }
  }
  writeFileSync(join(OUT, 'parts.json'), JSON.stringify({ kanji: partsOut, gloss }))
  console.log(`구성 요소: ${Object.keys(partsOut).length}자, 부수 있음 ${Object.values(partsOut).filter((x) => x.rad).length}자, 비상용 요소 ${Object.keys(gloss).length}개`)

  buildWords(entries, dic, problems)

  console.log(`상용한자 ${entries.length}자 생성`)
  const byGrade = entries.reduce<Record<number, number>>((a, e) => ((a[e.g] = (a[e.g] ?? 0) + 1), a), {})
  console.log('학년별:', byGrade)
  if (problems.length) {
    console.log(`\n확인 필요 ${problems.length}건:`)
    for (const p of problems) console.log(' -', p)
  }
  if (process.argv.includes('--dump-list')) {
    // 훈음 작성용 목록: 한자 \t KANJIDIC 한국음 \t 영어뜻
    writeFileSync(
      join(SRC, 'list.tsv'),
      entries
        .map((e) => {
          const s = new Set([...(dic.get(e.k)?.ko ?? []), ...(e.old ? (dic.get(e.old)?.ko ?? []) : [])])
          return `${e.k}\t${e.old ?? ''}\t${[...s].join(',')}\t${e.en}`
        })
        .join('\n'),
    )
  }
  if (entries.length !== 2136) {
    console.error(`\n오류: 2136자가 아님 (${entries.length})`)
    process.exit(1)
  }
}

// ---------- 5. 중학 이상 → 중1~고3 ----------
/**
 * 일본에는 중학 이상 1110자의 학년별 배당이 없으므로 漢検 급수로 나눈다.
 *  4급(중학 재학) → 빈도순 앞 절반 중1(7), 뒤 절반 중2(8)
 *  3급(중학 졸업) → 중3(9)
 *  준2급(고교 재학) → 빈도순 앞 절반 고1(10), 뒤 절반 고2(11)
 *  2급(고교 졸업) → 고3(12)
 */
function assignUpperGrades(rows: WikiRow[], dic: Map<string, DicInfo>) {
  const level = new Map<string, string>()
  for (const line of readFileSync(join(ROOT, 'scripts', 'data', 'kanken.tsv'), 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const [k, lv] = line.split('\t')
    level.set(k, lv.trim())
  }
  const freq = (r: WikiRow) => dic.get(r.k)?.freq ?? (r.old ? dic.get(r.old)?.freq : undefined) ?? 9999
  const byLevel = new Map<string, WikiRow[]>()
  for (const r of rows) {
    if (r.g !== 7) continue
    const lv = level.get(r.k)
    if (!lv) throw new Error(`漢検 급수 없음: ${r.k}`)
    byLevel.set(lv, [...(byLevel.get(lv) ?? []), r])
  }
  const split = (list: WikiRow[] | undefined, first: number, second?: number) => {
    const sorted = [...(list ?? [])].sort((a, b) => freq(a) - freq(b))
    const half = second ? Math.ceil(sorted.length / 2) : sorted.length
    sorted.forEach((r, i) => (r.g = i < half ? first : second!))
  }
  split(byLevel.get('4'), 7, 8)
  split(byLevel.get('3'), 9)
  split(byLevel.get('準2'), 10, 11)
  split(byLevel.get('2'), 12)
}

// ---------- 6. 예시 단어 ----------
function buildWords(entries: KanjiEntry[], dic: Map<string, DicInfo>, problems: string[]) {
  const dir = join(ROOT, 'scripts', 'words')
  const ko = loadWordFiles(dir, 'ko')
  const ja = loadWordFiles(dir, 'ja')
  const jmFile = existsSync(join(SRC, 'jmdict'))
    ? readdirSync(join(SRC, 'jmdict')).find((f) => /^jmdict-eng-.*\.json$/.test(f))
    : undefined
  const jm = jmFile ? loadJmdict(join(SRC, 'jmdict', jmFile)) : undefined
  if (!jm) console.log('JMdict 없음 → 일본어 예시의 사전 대조는 건너뜀 (scripts/fetch-sources.sh)')

  // 한자 → 한국 음: 상용한자 훈음(신자체·정자 모두) + KANJIDIC
  const sounds = new Map<string, Set<string>>()
  const addSound = (c: string, xs: string[]) => {
    const set = sounds.get(c) ?? new Set()
    xs.forEach((x) => set.add(x))
    sounds.set(c, set)
  }
  for (const e of entries) {
    addSound(e.k, soundsOfKo(e.ko))
    if (e.old) addSound(e.old, soundsOfKo(e.ko))
  }
  for (const [c, d] of dic) addSound(c, d.ko)
  const soundsOf = (c: string) => [...(sounds.get(c) ?? [])]

  const out: Record<string, { ko: KoWord[]; ja: JaWord[] }> = {}
  const joyo = new Set(entries.map((e) => e.k))
  const oldOf = new Map(entries.filter((e) => e.old).map((e) => [e.k, e.old!]))
  let missing = 0
  let warns = 0
  for (const e of entries) {
    const targets = e.old ? [e.k, e.old] : [e.k]
    // 한국어 한자표기는 신자체로 써도 됨 → 상용한자 정자(旧字体)로 바꿔 저장 (学校 → 學校)
    const koList = (ko.get(e.k) ?? []).map(([h, w]) => [h, [...w].map((c) => oldOf.get(c) ?? c).join('')] as KoWord)
    const jaList = (ja.get(e.k) ?? []).map((r) => r.slice(0, 3) as JaWord)
    if (!koList.length || !jaList.length) missing++
    for (const w of koList) {
      const err = checkKo(targets, w, soundsOf)
      if (err) problems.push(`예시(ko) ${e.k} ${w.join(' ')}: ${err}`)
    }
    for (const w of jaList) {
      const { error, warn } = checkJa(targets, w, jm)
      if (error) problems.push(`예시(ja) ${e.k} ${w.slice(0, 2).join(' ')}: ${error}`)
      if (warn) warns++
      if (warn && process.argv.includes('--warn')) console.log(` · 예시(ja) ${e.k} ${w.slice(0, 2).join(' ')}: ${warn}`)
    }
    if (koList.length || jaList.length) out[e.k] = { ko: koList.slice(0, 3), ja: jaList.slice(0, 3) }
  }
  for (const k of new Set([...ko.keys(), ...ja.keys()])) if (!joyo.has(k)) problems.push(`예시: 상용한자가 아님 ${k}`)
  writeFileSync(join(OUT, 'words.json'), JSON.stringify(out))
  console.log(`예시 단어: ${Object.keys(out).length}자, 예시 없음(한쪽이라도) ${missing}자, 흔하지 않은 일본어 ${warns}개 (--warn 으로 목록)`)
}

main()
