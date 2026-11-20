import { useEffect, useState } from 'react'
import { loadParts, loadStrokes, POSITION_LABEL, POSITION_TERM, type KanjiPart, type PartsData } from '../lib/data'
import { useAppData } from '../lib/store'

/** 글자 바로 아래 요소마다 돌려 쓰는 색 (CSS 변수 --p0 ~ --p5) */
const PALETTE = 6

const OPEN_KEY = 'kanji-study:structure-open'
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

interface Row {
  part: KanjiPart
  depth: number
  color: number
}

/**
 * "구성" 섹션: 부수, 구성 요소(편방), 획 수.
 * 響 → 부수 音(소리 음), 20획 = 11 + 9, 郷(위·음 요소) + 音(아래·부수)
 */
export function KanjiStructure({ k, collapsible = false }: { k: string; collapsible?: boolean }) {
  const { byChar } = useAppData()
  const [data, setData] = useState<PartsData | null>(null)
  const [paths, setPaths] = useState<string[] | null>(null)
  const [deep, setDeep] = useState(false)
  const [open, setOpen] = useState(() => (collapsible ? readOpen() : true))

  useEffect(() => {
    let alive = true
    loadParts().then((d) => alive && setData(d), () => {})
    loadStrokes().then((s) => alive && setPaths(s[k] ?? []), () => {})
    return () => {
      alive = false
    }
  }, [k])

  const toggleOpen = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1')
      } catch {
        /* 저장 불가 */
      }
      return !o
    })
  }

  const info = data?.kanji[k]
  const parts = info?.parts ?? []
  const total = byChar.get(k)?.s ?? paths?.length ?? 0

  // 획 번호 → 색 번호 (큰 요소 기준)
  const strokeColor = new Map<number, number>()
  parts.forEach((p, i) => p.s.forEach((s) => strokeColor.set(s, i % PALETTE)))

  const rows: Row[] = []
  const add = (part: KanjiPart, depth: number, color: number) => {
    rows.push({ part, depth, color })
    if (deep) part.c?.forEach((c) => add(c, depth + 1, color))
  }
  parts.forEach((p, i) => add(p, 0, i % PALETTE))
  const hasChildren = parts.some((p) => p.c?.length)

  // "20획 = 11 + 9": 큰 요소들의 획 수 합이 전체와 맞을 때만 나눠서 적음
  const counts = parts.map((p) => p.s.length)
  const strokeText =
    counts.length > 1 && counts.reduce((a, b) => a + b, 0) === total ? `${total}획 = ${counts.join(' + ')}` : `${total}획`

  /** "향 · home town", 변형이면 "邑의 변형 · 읍 · village" */
  const gloss = (p: KanjiPart): string => {
    const look = p.o ?? p.e
    const bits: string[] = []
    if (p.o) bits.push(`${p.o}의 변형`)
    const joyo = byChar.get(look)
    if (joyo) bits.push(joyo.ko)
    else {
      const g = data?.gloss[look]
      if (g?.ko) bits.push(g.ko)
      if (g?.en) bits.push(g.en)
    }
    return bits.join(' · ')
  }

  const header = (
    <div className="structure-head">
      <span className="section-title">구성</span>
      {info?.rad && !open && (
        <span className="muted small">
          부수 <span lang="ja">{info.rad.f}</span> {info.rad.ko}
        </span>
      )}
      {collapsible && <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>}
    </div>
  )

  return (
    <section className="structure">
      {collapsible ? (
        <button className="structure-toggle" onClick={toggleOpen} aria-expanded={open}>
          {header}
        </button>
      ) : (
        header
      )}

      {open && (
        <>
          <div className="structure-overview">
            <svg className="structure-diagram" viewBox="0 0 109 109" aria-label={`${k} 구성 요소별 색`}>
              {(paths ?? []).map((d, i) => (
                <path key={i} d={d} className={strokeColor.has(i + 1) ? `pc${strokeColor.get(i + 1)}` : 'pc-none'} />
              ))}
            </svg>
            <div className="structure-facts">
              {info?.rad && (
                <div>
                  <div className="fact-label">부수</div>
                  <div className="fact-main">
                    <span lang="ja" className="rad-form">
                      {info.rad.f}
                    </span>
                    {info.rad.ko}
                  </div>
                  <div className="muted small" lang="ja">
                    {info.rad.ja}
                  </div>
                </div>
              )}
              <div>
                <div className="fact-label">획</div>
                <div className="fact-main num">{strokeText}</div>
              </div>
              {data && parts.length === 0 && <div className="muted small">더 나뉘지 않는 글자예요.</div>}
            </div>
          </div>

          {rows.length > 0 && (
            <ul className="part-rows">
              {rows.map((r, i) => (
                <li key={i} className={`part-row d${Math.min(r.depth, 3)}`} style={{ paddingLeft: r.depth * 18 }}>
                  <span lang="ja" className={`part-char pc${r.color}`}>
                    {r.part.e}
                  </span>
                  <div className="part-info">
                    {gloss(r.part) && <div className="part-gloss">{gloss(r.part)}</div>}
                    <div className="part-chips">
                      {r.part.p && (
                        <>
                          <span className={`pchip pc${r.color}`}>{POSITION_LABEL[r.part.p]}</span>
                          {POSITION_TERM[r.part.p] && (
                            <span className={`pchip pc${r.color}`} lang="ja">
                              {POSITION_TERM[r.part.p]}
                            </span>
                          )}
                        </>
                      )}
                      {r.part.r && <span className="pchip rad">부수</span>}
                      {r.part.ph && <span className="pchip plain">음 요소</span>}
                      <span className="pchip plain">{r.part.s.length}획</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasChildren && (
            <button className="btn small" onClick={() => setDeep((d) => !d)}>
              {deep ? '큰 요소만 보기' : '더 잘게 나누기'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
