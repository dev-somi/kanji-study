import { useEffect, useMemo, useState } from 'react'
import { Examples } from '../components/Examples'
import { KanjiStructure } from '../components/KanjiStructure'
import { Readings } from '../components/Readings'
import { StrokeOrder } from '../components/StrokeOrder'
import { GRADE_LABEL, kataToHira } from '../lib/data'
import { resetCard, setOverride } from '../lib/repo'
import { cardKey, formatInterval, State } from '../lib/srs'
import { useAppData } from '../lib/store'
import { MATURE_STABILITY, STAGE_LABEL, STAGES, type CardRow, type KanjiEntry, type Stage } from '../lib/types'

type Status = 'none' | 'learning' | 'mature'
function statusOf(c: CardRow | undefined): Status {
  if (!c || c.state === State.New) return 'none'
  return c.stability >= MATURE_STABILITY ? 'mature' : 'learning'
}

const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export function Browse() {
  const { kanji, cards } = useAppData()
  const [q, setQ] = useState('')
  const [grade, setGrade] = useState<number | 0>(0)
  const [stage, setStage] = useState<Stage>('w')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [open, setOpen] = useState<KanjiEntry | null>(null)

  const list = useMemo(() => {
    const query = kataToHira(q.trim())
    return kanji.filter((e) => {
      if (grade && e.g !== grade) return false
      if (status !== 'all' && statusOf(cards.get(cardKey(e.k, stage))) !== status) return false
      if (!query) return true
      if (e.k === query || e.old === query) return true
      if (e.ko.includes(query)) return true
      const readings = [...e.on, ...e.kun, ...e.sp].map((r) => kataToHira(r.replace(/-/g, '')))
      return readings.some((r) => r.startsWith(query))
    })
  }, [kanji, cards, q, grade, stage, status])

  return (
    <div className="page browse">
      <header className="browse-top">
        <input
          className="search"
          type="search"
          placeholder="한자 · 훈음 · 읽기(かな) 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="filters">
          <select value={grade} onChange={(e) => setGrade(Number(e.target.value))} aria-label="학년">
            <option value={0}>전체 학년</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {GRADE_LABEL(g)}
              </option>
            ))}
          </select>
          <div className="seg" role="tablist" aria-label="단계">
            {STAGES.map((s) => (
              <button key={s} className={stage === s ? 'on' : ''} onClick={() => setStage(s)}>
                {STAGE_LABEL[s]}
              </button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status | 'all')} aria-label="상태">
            <option value="all">모든 상태</option>
            <option value="none">미학습</option>
            <option value="learning">학습 중</option>
            <option value="mature">숙달</option>
          </select>
        </div>
        <div className="muted small">{list.length}자</div>
      </header>

      <div className="kanji-grid">
        {list.map((e) => (
          <button key={e.k} className={`tile st-${statusOf(cards.get(cardKey(e.k, stage)))}`} onClick={() => setOpen(e)}>
            <span className="tile-k" lang="ja">
              {e.k}
            </span>
            <span className="tile-ko">{e.ko}</span>
          </button>
        ))}
      </div>

      {open && <KanjiSheet e={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function KanjiSheet({ e, onClose }: { e: KanjiEntry; onClose: () => void }) {
  const { cards, byChar } = useAppData()
  const live = byChar.get(e.k) ?? e
  const [editing, setEditing] = useState(false)
  const [ko, setKo] = useState(live.ko)

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`${e.k} 상세`} onClick={(ev) => ev.stopPropagation()}>
        <button className="icon-btn sheet-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
        <div className="sheet-head">
          <StrokeOrder k={e.k} size={150} />
          <div className="sheet-info">
            {editing ? (
              <form
                className="ko-edit"
                onSubmit={async (ev) => {
                  ev.preventDefault()
                  if (ko.trim()) await setOverride(e.k, ko)
                  setEditing(false)
                }}
              >
                <input value={ko} onChange={(ev) => setKo(ev.target.value)} autoFocus aria-label="훈음" />
                <button className="btn small primary">저장</button>
              </form>
            ) : (
              <div className="sheet-ko">
                {live.ko}
                <button className="link-btn small" onClick={() => setEditing(true)}>
                  수정
                </button>
              </div>
            )}
            <div className="muted small">
              {live.s}획 · {GRADE_LABEL(live.g)}
              {live.old && (
                <>
                  {' '}
                  · 정자 <span lang="ko">{live.old}</span>
                </>
              )}
            </div>
            {live.en && <div className="muted small">{live.en}</div>}
          </div>
        </div>
        <Readings e={live} />
        <Examples k={e.k} old={e.old} />
        <KanjiStructure k={e.k} />
        <div className="card-status">
          {STAGES.map((s) => {
            const c = cards.get(cardKey(e.k, s))
            const started = c && c.state !== State.New
            return (
              <div key={s} className="card-status-row">
                <b>{STAGE_LABEL[s]}</b>
                {started ? (
                  <>
                    <span className="muted small">
                      다음 복습 {c.due <= Date.now() ? '지금' : formatInterval(c.due - Date.now()) + ' 후'} · 안정도 {formatInterval(c.stability * 86400000)} · {c.reps}회
                      {c.lapses ? ` · 틀림 ${c.lapses}` : ''}
                    </span>
                    <button
                      className="link-btn small danger"
                      onClick={() => {
                        if (confirm(`${e.k} ${STAGE_LABEL[s]} 카드를 처음부터 다시 배울까요?`)) void resetCard(e.k, s)
                      }}
                    >
                      초기화
                    </button>
                  </>
                ) : (
                  <span className="muted small">아직 안 배움</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
