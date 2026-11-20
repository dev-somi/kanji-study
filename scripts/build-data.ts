/**
 * 데이터 빌드 스크립트
 *  입력 (data-src/, git 미포함 — scripts/fetch-sources.sh 로 내려받음)
 *   - wiki/joyo.json        : ja.wikipedia「常用漢字一覧」wikitext (CC BY-SA) → 상용한자 목록, 공식 음훈, 旧字体, 학년
 *   - kanjidic/kanjidic2.xml: KANJIDIC2 (EDRDG, CC BY-SA) → 빈도, 한국 음(검증용), 영어 뜻
 *   - kanjivg/kanji/*.svg   : KanjiVG (CC BY-SA) → 획순 path
 *   - scripts/korean/*.tsv  : 한국어 훈음 (한자\t훈음)
 *  출력
 *   - public/data/kanji.json
 *   - public/data/strokes.json
 *   - public/data/parts.json   : 구성 요소 트리 + 부수 + 상용한자 밖 요소의 음·뜻
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { collectElements, loadRadicals, parseParts, resolveRadical, type PartOut, type RadicalOut } from './structure'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'data-src')
const OUT = join(ROOT, 'public', 'data')

export interface KanjiEntry {
  id: number // 학습 순서 (0부터)
  k: string // 신자체
  old?: string // 旧字体 (한국 정자와 대부분 일치)
  g: number // 학년 1~6, 7 = 중학교 이상
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

/** 두음법칙: 첫소리 ㄹ→ㄴ/ㅇ, ㄴ→ㅇ */
function initialLaw(syl: string): string {
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

main()
