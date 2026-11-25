import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DrawPad, type DrawPadHandle } from '../components/DrawPad'
import { Examples } from '../components/Examples'
import { KanjiStructure } from '../components/KanjiStructure'
import { Readings } from '../components/Readings'
import { StrokeOrder } from '../components/StrokeOrder'
import { GRADE_LABEL, loadParts, loadStrokes, loadWords } from '../lib/data'
import { addExtraNew, db, getExtraNew, withExtraNew } from '../lib/db'
import { gradeCard, undoGrade, type UndoToken } from '../lib/repo'
import {
  buildQueue,
  dayStart,
  filterQueue,
  formatInterval,
  pickNext,
  previewIntervals,
  Rating,
  remaining,
  todayCounts,
  type Grade,
  type NextCard,
  type StudyMode,
} from '../lib/srs'
import { useAppData } from '../lib/store'
import { STAGE_LABEL, type Stage } from '../lib/types'

const GRADES: { g: Grade; label: string; cls: string }[] = [
  { g: Rating.Again, label: '다시', cls: 'again' },
  { g: Rating.Hard, label: '어려움', cls: 'hard' },
  { g: Rating.Good, label: '알맞음', cls: 'good' },
  { g: Rating.Easy, label: '쉬움', cls: 'easy' },
]

export function Study({ stage, mode, onExit }: { stage: Stage; mode: StudyMode; onExit: () => void }) {
  const { kanji, byChar, settings } = useAppData()
  const [current, setCurrent] = useState<NextCard | undefined>(undefined) // undefined = 계산 중
  const [left, setLeft] = useState({ learning: 0, review: 0, fresh: 0 })
  const [revealed, setRevealed] = useState(false)
  const [undo, setUndo] = useState<UndoToken | null>(null)
  const [done, setDone] = useState(0)
  const [busy, setBusy] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)
  const [overlay, setOverlay] = useState<string[] | undefined>()
  const [showOverlay, setShowOverlay] = useState(true)
  const [hint, setHint] = useState(false)
  const [wordHint, setWordHint] = useState(false)
  const [jaHint, setJaHint] = useState(false)
  const pad = useRef<DrawPadHandle>(null)

  // 큐는 DB 에서 직접 읽어 계산 (live query 반영 지연과 무관하게 정확히)
  const advance = useCallback(
    async (avoid?: string) => {
      const now = Date.now()
      const rows = await db.cards.toArray()
      const logs = await db.logs.where('review').aboveOrEqual(dayStart(now, settings.dayStartHour)).toArray()
      const s = withExtraNew(settings, await getExtraNew(settings.dayStartHour))
      const full = buildQueue({
        kanji,
        cards: new Map(rows.map((r) => [r.key, r])),
        stage,
        now,
        settings: s,
        counts: todayCounts(logs, stage, now, settings.dayStartHour),
      })
      const q = filterQueue(full, mode)
      setLeft(remaining(q))
      setCurrent(pickNext(q, avoid))
      setRevealed(false)
      setHint(false)
      setWordHint(false)
      setJaHint(false)
      setOverlay(undefined)
      setStrokeCount(0)
      pad.current?.clear()
    },
    [kanji, settings, stage, mode],
  )

  useEffect(() => {
    void advance()
    // 획순 데이터 미리 받아두기
    void loadStrokes().catch(() => {})
    void loadParts().catch(() => {})
    void loadWords().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const entry = current ? byChar.get(current.k) : undefined
  const intervals = useMemo(
    () => (current && revealed ? previewIntervals(current.row, Date.now(), settings.retention) : null),
    [current, revealed, settings.retention],
  )

  const reveal = useCallback(() => {
    if (!current || revealed) return
    setRevealed(true)
    if (stage === 'w')
      loadStrokes()
        .then((all) => setOverlay(all[current.k]))
        .catch(() => {})
  }, [current, revealed, stage])

  const grade = useCallback(
    async (g: Grade) => {
      if (!current || !revealed || busy) return
      setBusy(true)
      try {
        const t = await gradeCard(current.k, stage, g, settings.retention)
        setUndo(t)
        setDone((d) => d + 1)
        await advance(current.k)
      } finally {
        setBusy(false)
      }
    },
    [current, revealed, busy, stage, settings.retention, advance],
  )

  const doUndo = useCallback(async () => {
    if (!undo || busy) return
    setBusy(true)
    try {
      await undoGrade(undo)
      const k = undo.key.split(':')[0]
      setUndo(null)
      setDone((d) => Math.max(0, d - 1))
      // 되돌린 카드를 바로 다시 보여줌 (정답 공개 상태)
      const row = await db.cards.get(undo.key)
      await advance()
      setCurrent({ k, row: row && row.state !== 0 ? row : undefined, isNew: !row || row.state === 0 })
      setRevealed(true)
      if (stage === 'w') loadStrokes().then((all) => setOverlay(all[k])).catch(() => {})
    } finally {
      setBusy(false)
    }
  }, [undo, busy, advance, stage])

  // 키보드 단축키 (맥)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') return onExit()
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        return reveal()
      }
      if (revealed && ['1', '2', '3', '4'].includes(e.key)) return void grade(Number(e.key) as Grade)
      if (revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        return void grade(Rating.Good)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (!revealed && stage === 'w' && strokeCount > 0) pad.current?.undo()
        else void doUndo()
      }
      if (!revealed && stage === 'w' && (e.key === 'Backspace' || e.key === 'Delete')) pad.current?.clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, reveal, grade, doUndo, onExit, stage, strokeCount])

  const header = (
    <header className="study-top">
      <button className="icon-btn" onClick={onExit} aria-label="닫기">
        ✕
      </button>
      <div className="study-title">
        <span className={`mode-tag ${mode}`}>{mode === 'review' ? '복습' : '새 한자'}</span>
        {STAGE_LABEL[stage]}
        <span className="counts">
          {mode === 'review' ? (
            <>
              <span className="c-learn" title="틀려서 다시 익히는 중">
                {left.learning}
              </span>
              <span className="c-review" title="복습">
                {left.review}
              </span>
            </>
          ) : (
            <>
              <span className="c-learn" title="익히는 중">
                {left.learning}
              </span>
              <span className="c-new" title="새 카드">
                {left.fresh}
              </span>
            </>
          )}
        </span>
      </div>
      <button className="icon-btn" onClick={doUndo} disabled={!undo || busy} aria-label="채점 되돌리기" title="채점 되돌리기 (⌘Z)">
        ↶
      </button>
    </header>
  )

  if (current === undefined) return <div className="study">{header}</div>

  if (current === null || !entry)
    return (
      <div className="study">
        {header}
        <div className="study-done">
          <div className="done-emoji" aria-hidden>
            🎉
          </div>
          <h2>
            {mode === 'review' ? `오늘 ${STAGE_LABEL[stage]} 복습 끝!` : `오늘 새 한자(${STAGE_LABEL[stage]}) 끝!`}
          </h2>
          <p className="muted">이번 세션에서 {done}장 채점했어요.</p>
          {stage === 'r' && mode === 'new' && settings.readUnlock === 'auto' && (
            <p className="muted small">
              읽기 카드는 쓰기 카드가 충분히 익으면(다음 복습이 7일 이후) 열려요. 설정에서 바꿀 수 있어요.
            </p>
          )}
          <div className="done-actions">
            {mode === 'new' && (
              <button
                className="btn"
                onClick={async () => {
                  await addExtraNew(stage, 10, settings.dayStartHour)
                  await advance()
                }}
              >
                새 한자 10개 더
              </button>
            )}
            <button className="btn primary" onClick={onExit}>
              홈으로
            </button>
          </div>
          {undo && (
            <button className="link-btn" onClick={doUndo}>
              마지막 채점 되돌리기
            </button>
          )}
        </div>
      </div>
    )

  return (
    <div className="study">
      {header}
      <main className={`study-body stage-${stage}`}>
        {stage === 'w' ? (
          <>
            <div className="prompt">
              {current.isNew && <span className="badge new">NEW</span>}
              <div className="prompt-ko">{entry.ko}</div>
              {(hint || revealed) && (
                <div className="prompt-hint">
                  {entry.s}획 · {GRADE_LABEL(entry.g)}
                </div>
              )}
              {wordHint && !revealed && <Examples k={entry.k} hint="ko" />}
              {jaHint && !revealed && <Examples k={entry.k} hint="ja" />}
              {!revealed && (!hint || !wordHint || !jaHint) && (
                <div className="hint-btns">
                  {!hint && (
                    <button className="link-btn small" onClick={() => setHint(true)}>
                      힌트 (획수)
                    </button>
                  )}
                  {!wordHint && (
                    <button className="link-btn small" onClick={() => setWordHint(true)}>
                      힌트 (한국어)
                    </button>
                  )}
                  {!jaHint && (
                    <button className="link-btn small" onClick={() => setJaHint(true)}>
                      힌트 (일본어)
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className={`write-area ${revealed ? 'revealed' : ''}`}>
              <div className="pad-col">
                <DrawPad ref={pad} readOnly={revealed} overlay={revealed && showOverlay ? overlay : undefined} onChange={setStrokeCount} />
                {revealed && overlay && (
                  <label className="toggle small">
                    <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
                    정답 겹쳐보기
                  </label>
                )}
              </div>
              {revealed && (
                <div className="answer-col">
                  <StrokeOrder k={entry.k} size={180} />
                  <div className="answer-meta">
                    {entry.old && (
                      <span className="old-form" title="旧字体 / 한국 정자">
                        정자 <b lang="ko">{entry.old}</b>
                      </span>
                    )}
                    <span className="muted small">탭하면 획순 다시</span>
                  </div>
                </div>
              )}
            </div>
            {revealed && <Readings e={entry} compact />}
            {revealed && <Examples k={entry.k} old={entry.old} collapsible />}
            {revealed && <KanjiStructure k={entry.k} collapsible />}
          </>
        ) : (
          <>
            <div className="prompt read" onClick={reveal}>
              {current.isNew && <span className="badge new">NEW</span>}
              <div className="prompt-kanji" lang="ja">
                {entry.k}
              </div>
              {!revealed && <div className="muted small">음독·훈독을 떠올려 보세요</div>}
            </div>
            {revealed && (
              <div className="read-answer">
                <Readings e={entry} />
                <div className="read-ko">
                  {entry.ko}
                  {entry.old && (
                    <span className="old-form">
                      정자 <b lang="ko">{entry.old}</b>
                    </span>
                  )}
                </div>
                {entry.en && <div className="muted small">{entry.en}</div>}
                <Examples k={entry.k} old={entry.old} collapsible />
                <KanjiStructure k={entry.k} collapsible />
              </div>
            )}
          </>
        )}
      </main>

      <footer className="study-actions">
        {!revealed ? (
          <div className="row">
            {stage === 'w' && (
              <>
                <button className="btn" onClick={() => pad.current?.undo()} disabled={!strokeCount}>
                  한 획 지우기
                </button>
                <button className="btn" onClick={() => pad.current?.clear()} disabled={!strokeCount}>
                  전체 지우기
                </button>
              </>
            )}
            <button className="btn primary grow" onClick={reveal}>
              정답 보기
            </button>
          </div>
        ) : (
          <div className="grades">
            {GRADES.map(({ g, label, cls }) => (
              <button key={g} className={`grade ${cls}`} onClick={() => grade(g)} disabled={busy}>
                <span className="grade-int">{intervals ? formatInterval(intervals[g]) : ''}</span>
                <span className="grade-label">{label}</span>
                <kbd>{g}</kbd>
              </button>
            ))}
          </div>
        )}
      </footer>
    </div>
  )
}
