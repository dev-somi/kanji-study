import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

type Point = [number, number, number] // x, y (0~1 정규화), pressure
export type Strokes = Point[][]

export interface DrawPadHandle {
  clear: () => void
  undo: () => void
  strokes: () => Strokes
}

interface Props {
  /** 정답 공개 후 읽기 전용 */
  readOnly?: boolean
  /** 정답 획을 반투명하게 겹쳐 보여줄 SVG path 목록 (KanjiVG 109×109 좌표) */
  overlay?: string[]
  onChange?: (count: number) => void
}

/** 손가락·트랙패드·마우스·애플펜슬로 쓰는 정사각형 캔버스 */
export const DrawPad = forwardRef<DrawPadHandle, Props>(function DrawPad({ readOnly, overlay, onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const strokesRef = useRef<Strokes>([])
  const drawing = useRef<Point[] | null>(null)
  const [size, setSize] = useState(0)

  const redraw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const w = cv.width / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, w)
    const color = getComputedStyle(cv).getPropertyValue('--ink').trim() || '#222'
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const base = w / 28
    for (const s of strokesRef.current) {
      if (s.length === 1) {
        ctx.beginPath()
        ctx.fillStyle = color
        ctx.arc(s[0][0] * w, s[0][1] * w, base / 2, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      for (let i = 1; i < s.length; i++) {
        const [x0, y0, p0] = s[i - 1]
        const [x1, y1, p1] = s[i]
        ctx.lineWidth = base * (0.6 + 0.8 * ((p0 + p1) / 2))
        ctx.beginPath()
        ctx.moveTo(x0 * w, y0 * w)
        ctx.lineTo(x1 * w, y1 * w)
        ctx.stroke()
      }
    }
  }, [])

  // 크기 맞추기 (레티나 대응)
  useEffect(() => {
    const wrap = wrapRef.current!
    const ro = new ResizeObserver(() => {
      const w = Math.floor(wrap.clientWidth)
      setSize(w)
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !size) return
    const dpr = window.devicePixelRatio || 1
    cv.width = size * dpr
    cv.height = size * dpr
    redraw()
  }, [size, redraw])

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        strokesRef.current = []
        redraw()
        onChange?.(0)
      },
      undo() {
        strokesRef.current.pop()
        redraw()
        onChange?.(strokesRef.current.length)
      },
      strokes: () => strokesRef.current,
    }),
    [redraw, onChange],
  )

  const toPoint = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect()
    // 마우스/트랙패드는 pressure 0.5 고정, 손가락은 0 이 오는 경우가 많아 보정
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, p]
  }

  const onDown = (e: React.PointerEvent) => {
    if (readOnly) return
    e.preventDefault()
    canvasRef.current!.setPointerCapture(e.pointerId)
    drawing.current = [toPoint(e)]
    strokesRef.current.push(drawing.current)
    redraw()
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return
    e.preventDefault()
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    const r = canvasRef.current!.getBoundingClientRect()
    for (const ev of events) {
      const p = e.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5
      drawing.current.push([(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, p])
    }
    redraw()
  }
  const onUp = () => {
    if (!drawing.current) return
    drawing.current = null
    onChange?.(strokesRef.current.length)
  }

  return (
    <div ref={wrapRef} className={`drawpad ${readOnly ? 'readonly' : ''}`}>
      <svg className="drawpad-grid" viewBox="0 0 100 100" aria-hidden>
        <line x1="50" y1="0" x2="50" y2="100" />
        <line x1="0" y1="50" x2="100" y2="50" />
      </svg>
      {overlay && (
        <svg className="drawpad-overlay" viewBox="0 0 109 109" aria-hidden>
          {overlay.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
      )}
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </div>
  )
})
