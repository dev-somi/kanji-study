/**
 * KanjiVG SVG → 글자 구성 요소 트리, KANJIDIC 부수 번호 → 자리에 맞는 부수 이름.
 * my-kanji-dict(data-build/parse_kanjivg.py, radicals.py)의 규칙을 그대로 옮긴 것.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Position = 'left' | 'right' | 'top' | 'bottom' | 'middle' | 'tare' | 'nyo' | 'kamae' | 'inside'

// kvg:position → 앱 위치. 감싸인 쪽(tarec, nyoc, kamaec)은 inside 로 묶는다
const POSITIONS: Record<string, Position> = {
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
  middle: 'middle',
  tare: 'tare',
  nyo: 'nyo',
  kamae: 'kamae',
  tarec: 'inside',
  nyoc: 'inside',
  kamaec: 'inside',
}
// 강희 부수와 맞는 표시만 (nelson, jis 는 다른 사전 분류)
const RADICAL_KINDS = new Set(['general', 'tradit'])

/** 출력용 요소 (키를 짧게) */
export interface PartOut {
  e: string // 글자 안에서 띤 자형 (亻)
  o?: string // 변형이면 본래 글자 (人)
  p?: Position
  r?: 1 // 부수
  ph?: 1 // 음 요소
  s: number[] // 이 요소에 속한 획 번호 (1부터)
  c?: PartOut[]
}

interface Part {
  e: string
  o?: string
  p?: Position
  r: boolean
  ph: boolean
  s: number[]
  c: Part[]
}

interface Tag {
  name: string
  attrs: Record<string, string>
  close: boolean
  selfClose: boolean
}

function* tags(svg: string): Generator<Tag> {
  const re = /<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g
  for (const m of svg.matchAll(re)) {
    const attrs: Record<string, string> = {}
    for (const a of m[3].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    yield { name: m[2], attrs, close: m[1] === '/', selfClose: m[4] === '/' }
  }
}

/** KanjiVG 파일 하나 → 글자 바로 아래 요소들 */
export function parseParts(svg: string): PartOut[] {
  // 획 그룹만 사용 (StrokeNumbers 그룹 제외)
  const start = svg.indexOf('<g id="kvg:StrokePaths_')
  const end = svg.indexOf('<g id="kvg:StrokeNumbers_')
  const body = svg.slice(start, end > 0 ? end : undefined)

  // 스택: 각 <g> 가 요소이면 Part, 이름 없는 묶음이면 null (내용을 위로 올림)
  type Frame = { part: Part | null; siblings: Part[]; strokes: number[] }
  const rootParts: Part[] = []
  const stack: Frame[] = []
  const openParts = new Map<string, Part>()
  let strokeNo = 0
  let depth = 0 // StrokePaths, 글자 루트 그룹을 건너뛰기 위한 깊이

  for (const t of tags(body)) {
    if (t.name === 'g' && !t.close) {
      depth++
      if (depth <= 2) {
        // 1: StrokePaths, 2: 글자 자체(響)
        if (depth === 2) stack.push({ part: null, siblings: rootParts, strokes: [] })
        continue
      }
      const parent = stack[stack.length - 1]
      const element = t.attrs['kvg:element']
      if (!element) {
        stack.push({ part: null, siblings: parent.siblings, strokes: [] })
        continue
      }
      const partNo = parseInt(t.attrs['kvg:part'] ?? '1', 10)
      // 떨어져 있는 조각(kvg:part 2 이상)은 첫 조각에 합친다
      let part = partNo > 1 ? openParts.get(element) : undefined
      if (!part) {
        part = { e: element, o: t.attrs['kvg:original'], p: POSITIONS[t.attrs['kvg:position'] ?? ''], r: false, ph: false, s: [], c: [] }
        parent.siblings.push(part)
        if (t.attrs['kvg:part']) openParts.set(element, part)
      }
      part.r ||= RADICAL_KINDS.has(t.attrs['kvg:radical'] ?? '')
      part.ph ||= t.attrs['kvg:phon'] !== undefined
      stack.push({ part, siblings: part.c, strokes: [] })
    } else if (t.name === 'g' && t.close) {
      depth--
      if (depth < 1) continue
      const frame = stack.pop()
      if (!frame) continue
      if (frame.part) frame.part.s.push(...frame.strokes)
      // 획 번호는 위로 전파
      const parent = stack[stack.length - 1]
      if (parent) parent.strokes.push(...frame.strokes)
    } else if (t.name === 'path') {
      strokeNo++
      const top = stack[stack.length - 1]
      if (top) top.strokes.push(strokeNo)
    }
  }

  const out = (p: Part): PartOut => ({
    e: p.e,
    ...(p.o ? { o: p.o } : {}),
    ...(p.p ? { p: p.p } : {}),
    ...(p.r ? { r: 1 as const } : {}),
    ...(p.ph ? { ph: 1 as const } : {}),
    s: p.s,
    ...(p.c.length ? { c: p.c.map(out) } : {}),
  })
  return rootParts.map(out)
}

// ---------- 부수 이름 ----------
interface RadicalName {
  number: number
  glyphs: string[] // 첫 글자가 대표 자형
  position: string
  ko: string
  ja: string
  isBase: boolean
}

export interface RadicalOut {
  n: number // 강희 부수 번호
  f: string // 이 글자에서 띤 자형
  ko: string
  ja: string
}

export function loadRadicals(root: string): Map<number, RadicalName[]> {
  const table = new Map<number, RadicalName[]>()
  for (const line of readFileSync(join(root, 'scripts/data/radicals.tsv'), 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue
    const [num, glyphs, position, ko, ja] = line.split('\t')
    const n = parseInt(num, 10)
    const rows = table.get(n) ?? []
    rows.push({ number: n, glyphs: [...glyphs], position, ko, ja, isBase: rows.length === 0 })
    table.set(n, rows)
  }
  return table
}

function* walk(parts: PartOut[]): Generator<PartOut> {
  for (const p of parts) {
    yield p
    if (p.c) yield* walk(p.c)
  }
}

/** 부수가 이 글자 안에서 실제로 띤 자형과, 자리까지 맞는 이름 (水가 왼쪽이면 氵 삼수변) */
export function resolveRadical(number: number, parts: PartOut[], table: Map<number, RadicalName[]>): RadicalOut | undefined {
  const rows = table.get(number)
  if (!rows) return undefined
  let best: { rank: number[]; form: string; row: RadicalName } | undefined
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]
    return false
  }
  for (const part of walk(parts)) {
    if (!part.r) continue
    for (const row of rows) {
      const byElement = row.glyphs.includes(part.e)
      if (!byElement && !(part.o && row.glyphs.includes(part.o))) continue
      if (row.position && row.position !== part.p) continue
      const rank = [byElement ? 1 : 0, row.position ? 1 : 0, row.isBase ? 0 : 1]
      if (!best || better(rank, best.rank)) best = { rank, form: byElement ? part.e : row.glyphs[0], row }
    }
  }
  const pick = best ?? { form: rows[0].glyphs[0], row: rows[0] }
  return { n: number, f: pick.form, ko: pick.row.ko, ja: pick.row.ja }
}

export function collectElements(parts: PartOut[]): Set<string> {
  const s = new Set<string>()
  for (const p of walk(parts)) {
    s.add(p.e)
    if (p.o) s.add(p.o)
  }
  return s
}
