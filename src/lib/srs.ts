/**
 * 간격 반복 스케줄러 (FSRS) + 오늘의 학습 큐 계산.
 * 이 파일은 DB/React 에 의존하지 않는 순수 함수만 둔다 (테스트 용이).
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs'
import {
  READ_UNLOCK_STABILITY,
  type CardRow,
  type KanjiEntry,
  type LogRow,
  type Settings,
  type Stage,
} from './types'

export { Rating, State }
export type { Grade }

const schedulers = new Map<number, ReturnType<typeof fsrs>>()
export function scheduler(retention: number) {
  let f = schedulers.get(retention)
  if (!f) {
    f = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true }))
    schedulers.set(retention, f)
  }
  return f
}

export function cardKey(k: string, stage: Stage) {
  return `${k}:${stage}`
}

export function rowToCard(row: CardRow | undefined, now: number): Card {
  if (!row) return createEmptyCard(new Date(now))
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    learning_steps: row.learning_steps,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
    // ts-fsrs 구버전 호환 필드 (있으면 무시됨)
    elapsed_days: 0,
  } as Card
}

export function cardToRow(k: string, stage: Stage, c: Card, now: number): CardRow {
  return {
    key: cardKey(k, stage),
    k,
    stage,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    learning_steps: c.learning_steps,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
    updated_at: now,
    dirty: 1,
  }
}

/** 채점 → 새 카드 상태와 로그 */
export function review(row: CardRow | undefined, k: string, stage: Stage, grade: Grade, now: number, retention: number) {
  const card = rowToCard(row, now)
  const { card: next } = scheduler(retention).next(card, new Date(now), grade)
  const newRow = cardToRow(k, stage, next, now)
  const log: LogRow = {
    id: crypto.randomUUID(),
    k,
    stage,
    rating: grade,
    state: card.state,
    review: now,
    updated_at: now,
    dirty: 1,
  }
  return { row: newRow, log }
}

/** 각 버튼을 눌렀을 때의 다음 간격 미리보기 */
export function previewIntervals(row: CardRow | undefined, now: number, retention: number): Record<Grade, number> {
  const rec = scheduler(retention).repeat(rowToCard(row, now), new Date(now))
  const out = {} as Record<Grade, number>
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    out[g] = rec[g].card.due.getTime() - now
  }
  return out
}

export function formatInterval(ms: number): string {
  const min = ms / 60000
  if (min < 1) return '<1분'
  if (min < 60) return `${Math.round(min)}분`
  const h = min / 60
  if (h < 24) return `${Math.round(h)}시간`
  const d = h / 24
  if (d < 30) return `${Math.round(d)}일`
  const mo = d / 30
  if (mo < 12) return `${mo.toFixed(mo < 3 ? 1 : 0)}개월`
  return `${(d / 365).toFixed(1)}년`
}

// ---------------- 하루 경계 ----------------

/** dayStartHour(기본 4시) 기준으로 '오늘'이 시작된 시각 */
export function dayStart(now: number, dayStartHour: number): number {
  const d = new Date(now)
  d.setHours(dayStartHour, 0, 0, 0)
  if (d.getTime() > now) d.setDate(d.getDate() - 1)
  return d.getTime()
}

/** 학습일 문자열 (YYYY-MM-DD, dayStartHour 기준) */
export function dayKey(ts: number, dayStartHour: number): string {
  const d = new Date(dayStart(ts, dayStartHour))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------------- 큐 ----------------

export interface TodayCounts {
  newDone: number // 오늘 새로 배운 카드 수
  reviewsDone: number // 오늘 복습(새 카드 제외) 횟수
}

export function todayCounts(logs: LogRow[], stage: Stage, now: number, dayStartHour: number): TodayCounts {
  const start = dayStart(now, dayStartHour)
  let newDone = 0
  let reviewsDone = 0
  for (const l of logs) {
    if (l.stage !== stage || l.review < start || l.rating === 0) continue // rating 0 = 되돌린 채점
    if (l.state === State.New) newDone++
    else if (l.state === State.Review) reviewsDone++
  }
  return { newDone, reviewsDone }
}

/** 읽기(2단계) 카드를 시작해도 되는 한자인지 */
export function isReadUnlocked(writeCard: CardRow | undefined, settings: Settings): boolean {
  if (settings.readUnlock === 'all') return true
  return !!writeCard && writeCard.state === State.Review && writeCard.stability >= READ_UNLOCK_STABILITY
}

export interface QueueInput {
  kanji: KanjiEntry[]
  cards: Map<string, CardRow> // key → row (두 단계 모두)
  stage: Stage
  now: number
  settings: Settings
  counts: TodayCounts
}

export interface Queue {
  learning: CardRow[] // 학습 중(단기) 카드 — 지금 보여줄 수 있는 것
  review: CardRow[] // 오늘 복습할 카드
  fresh: KanjiEntry[] // 오늘 새로 배울 카드
  learnAhead: CardRow[] // 곧(20분 내) 다시 볼 학습 중 카드
  newAvailable: number // 아직 시작 안 한 (조건 충족) 카드 전체 수
}

const LEARN_AHEAD_MS = 20 * 60 * 1000

export function buildQueue({ kanji, cards, stage, now, settings, counts }: QueueInput): Queue {
  const learning: CardRow[] = []
  const review: CardRow[] = []
  const learnAhead: CardRow[] = []
  for (const c of cards.values()) {
    if (c.stage !== stage || c.state === State.New) continue // New = 초기화/되돌린 카드 → 새 카드로 취급
    const isLearning = c.state === State.Learning || c.state === State.Relearning
    if (c.due <= now) (isLearning ? learning : review).push(c)
    else if (isLearning && c.due <= now + LEARN_AHEAD_MS) learnAhead.push(c)
  }
  learning.sort((a, b) => a.due - b.due)
  review.sort((a, b) => a.due - b.due)
  learnAhead.sort((a, b) => a.due - b.due)

  const reviewLeft = Math.max(0, settings.maxReviewsPerDay - counts.reviewsDone)
  const newLeft = Math.max(0, settings.newPerDay[stage] - counts.newDone)

  const fresh: KanjiEntry[] = []
  let newAvailable = 0
  for (const e of kanji) {
    const existing = cards.get(cardKey(e.k, stage))
    if (existing && existing.state !== State.New) continue
    if (stage === 'r' && !isReadUnlocked(cards.get(cardKey(e.k, 'w')), settings)) continue
    newAvailable++
    if (fresh.length < newLeft) fresh.push(e)
  }

  return { learning, review: review.slice(0, reviewLeft), fresh, learnAhead, newAvailable }
}

/**
 * 세션 종류
 *  - review: 복습 차례가 된 카드 + 복습하다 틀려 다시 익히는 카드(Relearning)
 *  - new: 새 카드 + 오늘 새로 배워 아직 익히는 중인 카드(Learning)
 */
export type StudyMode = 'review' | 'new'

export function filterQueue(q: Queue, mode: StudyMode): Queue {
  const want = mode === 'review' ? State.Relearning : State.Learning
  return {
    learning: q.learning.filter((c) => c.state === want),
    learnAhead: q.learnAhead.filter((c) => c.state === want),
    review: mode === 'review' ? q.review : [],
    fresh: mode === 'new' ? q.fresh : [],
    newAvailable: q.newAvailable,
  }
}

export type NextCard = { k: string; row?: CardRow; isNew: boolean } | null

/**
 * 다음에 보여줄 카드.
 *  1) 지금 시간이 된 학습 중 카드  2) 복습 카드  3) 새 카드  4) 곧 다시 볼 학습 중 카드(미리 보기)
 *  복습과 새 카드는 새 카드가 몰리지 않도록 섞는다. 직전 카드(avoid)는 가능하면 피한다.
 */
export function pickNext(q: Queue, avoid?: string): NextCard {
  const candidates: NonNullable<NextCard>[] = []
  for (const r of q.learning) candidates.push({ k: r.k, row: r, isNew: false })
  // 복습 4장마다 새 카드 1장 정도의 비율로 섞기
  const rv = q.review.map((r) => ({ k: r.k, row: r, isNew: false }))
  const nw = q.fresh.map((e) => ({ k: e.k, isNew: true }))
  const mixed: NonNullable<NextCard>[] = []
  let i = 0
  let j = 0
  while (i < rv.length || j < nw.length) {
    for (let n = 0; n < 4 && i < rv.length; n++) mixed.push(rv[i++])
    if (j < nw.length) mixed.push(nw[j++])
  }
  candidates.push(...mixed)
  for (const r of q.learnAhead) candidates.push({ k: r.k, row: r, isNew: false })
  if (!candidates.length) return null
  return candidates.find((c) => c.k !== avoid) ?? candidates[0]
}

export function remaining(q: Queue) {
  return {
    learning: q.learning.length + q.learnAhead.length,
    review: q.review.length,
    fresh: q.fresh.length,
  }
}
