import { useEffect, useMemo, useState } from 'react'
import { buildQueue, dayKey, dayStart, filterQueue, State, todayCounts, type StudyMode } from '../lib/srs'
import { useAppData } from '../lib/store'
import { onSyncStatus, type SyncStatus } from '../lib/sync'
import { MATURE_STABILITY, STAGES, type Stage } from '../lib/types'

export function Home({ onStudy, onSettings }: { onStudy: (s: Stage, m: StudyMode) => void; onSettings: () => void }) {
  const { kanji, cards, settings, recentLogs } = useAppData()
  const [now, setNow] = useState(() => Date.now())
  const [sync, setSync] = useState<SyncStatus>({ state: 'off' })

  useEffect(() => onSyncStatus(setSync), [])
  // 학습 중 카드 시간이 지나면 숫자가 바뀌도록 1분마다 갱신
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const stats = useMemo(() => {
    const out = {} as Record<Stage, { review: number; fresh: number; started: number; mature: number; newAvailable: number }>
    for (const stage of STAGES) {
      const q = buildQueue({ kanji, cards, stage, now, settings, counts: todayCounts(recentLogs, stage, now, settings.dayStartHour) })
      let started = 0
      let mature = 0
      for (const c of cards.values()) {
        if (c.stage !== stage || c.state === State.New) continue
        started++
        if (c.stability >= MATURE_STABILITY) mature++
      }
      out[stage] = {
        review: count(filterQueue(q, 'review')),
        fresh: count(filterQueue(q, 'new')),
        started,
        mature,
        newAvailable: q.newAvailable,
      }
    }
    return out
  }, [kanji, cards, settings, recentLogs, now])

  const activity = useMemo(() => {
    const perDay = new Map<string, number>()
    for (const l of recentLogs) {
      const key = dayKey(l.review, settings.dayStartHour)
      perDay.set(key, (perDay.get(key) ?? 0) + 1)
    }
    const today = dayStart(now, settings.dayStartHour)
    const todayKey = dayKey(now, settings.dayStartHour)
    // 연속 학습일: 오늘 했으면 오늘부터, 아니면 어제부터 거꾸로
    let streak = 0
    let d = perDay.has(todayKey) ? today : today - 86400000
    while (perDay.has(dayKey(d + 3600000, settings.dayStartHour))) {
      streak++
      d -= 86400000
    }
    // 히트맵: 최근 12주 (일요일 시작 열)
    const weeks = 12
    const end = new Date(today)
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - (weeks - 1) * 7 - end.getDay())
    const cells: { key: string; n: number; future: boolean }[] = []
    for (let i = 0; i < weeks * 7; i++) {
      const dt = new Date(startDate)
      dt.setDate(startDate.getDate() + i)
      const key = dayKey(dt.getTime() + 3600000 * (settings.dayStartHour + 1), settings.dayStartHour)
      cells.push({ key, n: perDay.get(key) ?? 0, future: dt.getTime() > today })
    }
    return { streak, today: perDay.get(todayKey) ?? 0, cells }
  }, [recentLogs, settings.dayStartHour, now])

  const total = kanji.length
  const syncLabel =
    sync.state === 'off'
      ? '동기화 꺼짐'
      : sync.state === 'syncing'
        ? '동기화 중…'
        : sync.state === 'error'
          ? `동기화 오류`
          : '동기화됨'

  return (
    <div className="page home">
      <header className="home-top">
        <h1>
          상용한자 <span className="accent">2136</span>
        </h1>
        <button className={`sync-pill ${sync.state}`} onClick={onSettings} title={sync.message}>
          <span className="dot" />
          {syncLabel}
        </button>
      </header>

      <section className="today-strip">
        <div>
          <b>{activity.today}</b>
          <span>오늘 채점</span>
        </div>
        <div>
          <b>{activity.streak}</b>
          <span>연속 학습일</span>
        </div>
        <div>
          <b>{stats.w.started}</b>
          <span>쓰기 시작</span>
        </div>
      </section>

      {STAGES.map((stage) => {
        const s = stats[stage]
        return (
          <section key={stage} className={`stage-card stage-${stage}`}>
            <div className="stage-head">
              <div>
                <div className="stage-step">{stage === 'w' ? '1단계' : '2단계'}</div>
                <h2>{stage === 'w' ? '훈음 보고 한자 쓰기' : '한자 보고 음독·훈독'}</h2>
              </div>
              <div className="stage-sample" lang={stage === 'w' ? 'ko' : 'ja'} aria-hidden>
                {stage === 'w' ? '배울 학' : '学'}
              </div>
            </div>
            <div className="stage-nums">
              <div>
                <b>{s.started}</b>
                <span>배운 한자</span>
              </div>
              <div>
                <b>{s.newAvailable}</b>
                <span>남은 새 한자</span>
              </div>
              <div>
                <b>
                  {s.mature}
                  <small>/{total}</small>
                </b>
                <span>숙달</span>
              </div>
            </div>
            <div className="progress" aria-label={`시작 ${s.started}, 숙달 ${s.mature} / ${total}`}>
              <div className="progress-started" style={{ width: `${(s.started / total) * 100}%` }} />
              <div className="progress-mature" style={{ width: `${(s.mature / total) * 100}%` }} />
            </div>
            <div className="progress-legend muted small">
              <span>
                <i className="lg started" />
                학습 시작 {s.started}
              </span>
              <span>
                <i className="lg mature" />
                숙달(간격 21일+) {s.mature}
              </span>
            </div>
            {stage === 'r' && s.newAvailable === 0 && s.started === 0 && settings.readUnlock === 'auto' && (
              <p className="muted small">쓰기 카드가 익으면(다음 복습 7일 이상) 여기 읽기 카드가 하나씩 열려요.</p>
            )}
            <div className="mode-buttons">
              <button className="mode-btn review" onClick={() => onStudy(stage, 'review')} disabled={s.review === 0}>
                <span className="mode-name">복습</span>
                <b>{s.review}</b>
                <span className="mode-sub">{s.review === 0 ? '오늘 복습 끝' : '복습할 카드'}</span>
              </button>
              <button className="mode-btn new" onClick={() => onStudy(stage, 'new')} disabled={s.fresh === 0}>
                <span className="mode-name">새 한자</span>
                <b>{s.fresh}</b>
                <span className="mode-sub">
                  {s.fresh === 0 ? (s.newAvailable === 0 ? '열린 카드 없음' : '오늘 할당량 끝') : '오늘 배울 카드'}
                </span>
              </button>
            </div>
          </section>
        )
      })}

      <section className="heatmap-card">
        <div className="section-title">최근 12주</div>
        <div className="heatmap" role="img" aria-label="최근 12주 학습 기록">
          {activity.cells.map((c) => (
            <div
              key={c.key}
              className={`hm l${c.future ? 'x' : c.n === 0 ? 0 : c.n < 20 ? 1 : c.n < 50 ? 2 : c.n < 100 ? 3 : 4}`}
              title={`${c.key}: ${c.n}장`}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

/** 지금 바로 할 수 있는 카드 수 (곧 다시 볼 학습 중 카드 제외) */
function count(q: ReturnType<typeof filterQueue>) {
  return q.learning.length + q.review.length + q.fresh.length
}
