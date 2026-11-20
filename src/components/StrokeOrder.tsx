import { useEffect, useRef, useState } from 'react'
import { loadStrokes } from '../lib/data'

/** KanjiVG 경로로 획순을 한 획씩 그려 보여줌. 탭하면 다시 재생 */
export function StrokeOrder({ k, size = 200, autoplay = true }: { k: string; size?: number; autoplay?: boolean }) {
  const [paths, setPaths] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [run, setRun] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    let alive = true
    setPaths(null)
    loadStrokes().then(
      (all) => alive && setPaths(all[k] ?? []),
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [k])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !paths) return
    const els = [...svg.querySelectorAll<SVGPathElement>('path.stroke')]
    const nums = [...svg.querySelectorAll<SVGTextElement>('text')]
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!autoplay && run === 0) {
      els.forEach((p) => {
        p.style.transition = 'none'
        p.style.strokeDasharray = 'none'
      })
      nums.forEach((n) => (n.style.opacity = '1'))
      return
    }
    const timers: number[] = []
    let t = 0
    els.forEach((p, i) => {
      const len = p.getTotalLength()
      const dur = reduced ? 0 : Math.max(180, len * 5)
      p.style.transition = 'none'
      p.style.strokeDasharray = `${len} ${len}`
      p.style.strokeDashoffset = String(len)
      nums[i] && (nums[i].style.opacity = '0')
      timers.push(
        window.setTimeout(() => {
          p.style.transition = `stroke-dashoffset ${dur}ms ease-in-out`
          p.style.strokeDashoffset = '0'
          nums[i] && (nums[i].style.opacity = '1')
        }, t),
      )
      t += dur + (reduced ? 0 : 120)
    })
    return () => timers.forEach(clearTimeout)
  }, [paths, run, autoplay])

  if (failed) return <div className="stroke-fallback" lang="ja" style={{ width: size, height: size, fontSize: size * 0.8 }}>{k}</div>
  if (!paths) return <div className="stroke-loading" style={{ width: size, height: size }} />
  if (!paths.length)
    return (
      <div className="stroke-fallback" lang="ja" style={{ width: size, height: size, fontSize: size * 0.8 }}>
        {k}
      </div>
    )

  return (
    <button className="stroke-order" onClick={() => setRun((r) => r + 1)} title="다시 재생" aria-label={`${k} 획순 다시 재생`}>
      <svg ref={svgRef} viewBox="0 0 109 109" width={size} height={size}>
        <g className="guide">
          <line x1="54.5" y1="0" x2="54.5" y2="109" />
          <line x1="0" y1="54.5" x2="109" y2="54.5" />
        </g>
        <g className="ghost">
          {paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g className="strokes">
          {paths.map((d, i) => (
            <path key={i} className="stroke" d={d} />
          ))}
        </g>
        <g className="nums">
          {numberPositions(paths).map((p, i) =>
            p ? (
              <text key={i} x={p[0]} y={p[1]}>
                {i + 1}
              </text>
            ) : null,
          )}
        </g>
      </svg>
    </button>
  )
}

/** 획 시작점 근처에 번호 배치. 시작점이 겹치는 획(日의 1·2획 등)은 옆으로 밀어냄 */
function numberPositions(paths: string[]): ([number, number] | null)[] {
  const placed: [number, number][] = []
  return paths.map((d) => {
    const m = d.match(/^M\s*([\d.]+)[ ,]([\d.]+)/)
    if (!m) return null
    let x = +m[1] - 4
    let y = +m[2] - 2
    for (let tries = 0; tries < 4 && placed.some(([px, py]) => Math.abs(px - x) < 6 && Math.abs(py - y) < 6); tries++) {
      x += 7
    }
    placed.push([x, y])
    return [x, y]
  })
}
