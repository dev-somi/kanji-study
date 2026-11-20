import { describe, expect, it } from 'vitest'
import { buildQueue, cardKey, dayStart, filterQueue, isReadUnlocked, pickNext, Rating, review, State, todayCounts } from './srs'
import { DEFAULT_SETTINGS, type CardRow, type KanjiEntry, type LogRow } from './types'

const K = (k: string, id: number): KanjiEntry => ({ id, k, g: 1, s: 1, on: [], kun: [], sp: [], ko: k, en: '' })
const kanji = ['一', '二', '三', '四', '五'].map(K)
const NOW = new Date('2026-11-20T12:00:00').getTime()
const DAY = 86400000

function row(k: string, stage: 'w' | 'r', patch: Partial<CardRow>): CardRow {
  return {
    key: cardKey(k, stage),
    k,
    stage,
    due: NOW,
    stability: 1,
    difficulty: 5,
    scheduled_days: 1,
    reps: 1,
    lapses: 0,
    learning_steps: 0,
    state: State.Review,
    last_review: NOW - DAY,
    updated_at: NOW - DAY,
    dirty: 0,
    ...patch,
  }
}

describe('dayStart', () => {
  it('새벽 4시 이전은 전날로 친다', () => {
    const t = new Date('2026-11-20T03:00:00').getTime()
    expect(new Date(dayStart(t, 4)).getDate()).toBe(19)
    const t2 = new Date('2026-11-20T05:00:00').getTime()
    expect(new Date(dayStart(t2, 4)).getDate()).toBe(20)
  })
})

describe('buildQueue', () => {
  it('새 카드는 학습 순서대로, 하루 한도만큼', () => {
    const q = buildQueue({
      kanji,
      cards: new Map(),
      stage: 'w',
      now: NOW,
      settings: { ...DEFAULT_SETTINGS, newPerDay: { w: 3, r: 3 } },
      counts: { newDone: 0, reviewsDone: 0 },
    })
    expect(q.fresh.map((e) => e.k)).toEqual(['一', '二', '三'])
    expect(q.newAvailable).toBe(5)
  })

  it('오늘 이미 배운 수만큼 새 카드 한도가 줄어든다', () => {
    const q = buildQueue({
      kanji,
      cards: new Map(),
      stage: 'w',
      now: NOW,
      settings: { ...DEFAULT_SETTINGS, newPerDay: { w: 3, r: 3 } },
      counts: { newDone: 2, reviewsDone: 0 },
    })
    expect(q.fresh).toHaveLength(1)
  })

  it('시간이 된 복습만 큐에 들어가고, 학습 중 카드는 따로 분류', () => {
    const cards = new Map(
      [
        row('一', 'w', { due: NOW - 1000 }),
        row('二', 'w', { due: NOW + DAY }),
        row('三', 'w', { due: NOW - 500, state: State.Learning }),
        row('四', 'w', { due: NOW + 5 * 60000, state: State.Learning }),
        row('五', 'w', { due: NOW - 1000, state: State.New }), // 초기화된 카드 → 새 카드
      ].map((r) => [r.key, r]),
    )
    const q = buildQueue({ kanji, cards, stage: 'w', now: NOW, settings: DEFAULT_SETTINGS, counts: { newDone: 0, reviewsDone: 0 } })
    expect(q.review.map((r) => r.k)).toEqual(['一'])
    expect(q.learning.map((r) => r.k)).toEqual(['三'])
    expect(q.learnAhead.map((r) => r.k)).toEqual(['四'])
    expect(q.fresh.map((e) => e.k)).toEqual(['五'])
  })

  it('읽기 카드는 쓰기 카드 안정도 7일 이상인 한자만 열린다 (auto)', () => {
    const cards = new Map(
      [row('一', 'w', { stability: 10, due: NOW + 10 * DAY }), row('二', 'w', { stability: 3, due: NOW + 3 * DAY })].map((r) => [r.key, r]),
    )
    const q = buildQueue({ kanji, cards, stage: 'r', now: NOW, settings: DEFAULT_SETTINGS, counts: { newDone: 0, reviewsDone: 0 } })
    expect(q.fresh.map((e) => e.k)).toEqual(['一'])
    const q2 = buildQueue({
      kanji,
      cards,
      stage: 'r',
      now: NOW,
      settings: { ...DEFAULT_SETTINGS, readUnlock: 'all' },
      counts: { newDone: 0, reviewsDone: 0 },
    })
    expect(q2.fresh).toHaveLength(5)
    expect(isReadUnlocked(undefined, DEFAULT_SETTINGS)).toBe(false)
  })
})

describe('pickNext', () => {
  it('학습 중 → 복습/새 카드 순, 직전 카드는 피한다', () => {
    const cards = new Map(
      [row('一', 'w', { due: NOW - 1000, state: State.Learning }), row('二', 'w', { due: NOW - 1000 })].map((r) => [r.key, r]),
    )
    const q = buildQueue({ kanji, cards, stage: 'w', now: NOW, settings: DEFAULT_SETTINGS, counts: { newDone: 0, reviewsDone: 0 } })
    expect(pickNext(q)?.k).toBe('一')
    expect(pickNext(q, '一')?.k).toBe('二')
  })

  it('남은 게 없으면 null', () => {
    const q = buildQueue({
      kanji: [],
      cards: new Map(),
      stage: 'w',
      now: NOW,
      settings: DEFAULT_SETTINGS,
      counts: { newDone: 0, reviewsDone: 0 },
    })
    expect(pickNext(q)).toBeNull()
  })
})

describe('review + todayCounts', () => {
  it('새 카드를 채점하면 로그 state=New, 오늘 새 카드 수에 잡힌다', () => {
    const { row: r, log } = review(undefined, '一', 'w', Rating.Good, NOW, 0.9)
    expect(r.reps).toBe(1)
    expect(r.state).not.toBe(State.New)
    expect(log.state).toBe(State.New)
    const counts = todayCounts([log], 'w', NOW, 4)
    expect(counts).toEqual({ newDone: 1, reviewsDone: 0 })
    // 되돌린 로그(rating 0)는 세지 않음
    expect(todayCounts([{ ...log, rating: 0 } as LogRow], 'w', NOW, 4).newDone).toBe(0)
  })

  it('쉬움은 알맞음보다 다음 복습이 늦다', () => {
    const good = review(undefined, '一', 'w', Rating.Good, NOW, 0.9).row
    const easy = review(undefined, '一', 'w', Rating.Easy, NOW, 0.9).row
    expect(easy.due).toBeGreaterThan(good.due)
  })
})

describe('filterQueue (복습 / 새 한자 분리)', () => {
  const cards = new Map(
    [
      row('一', 'w', { due: NOW - 1000 }), // 복습
      row('二', 'w', { due: NOW - 1000, state: State.Relearning }), // 복습하다 틀림
      row('三', 'w', { due: NOW - 1000, state: State.Learning }), // 오늘 새로 배우는 중
    ].map((r) => [r.key, r]),
  )
  const q = buildQueue({ kanji, cards, stage: 'w', now: NOW, settings: DEFAULT_SETTINGS, counts: { newDone: 0, reviewsDone: 0 } })

  it('복습 세션: 복습 + 다시 익히는 카드만', () => {
    const r = filterQueue(q, 'review')
    expect(r.review.map((c) => c.k)).toEqual(['一'])
    expect(r.learning.map((c) => c.k)).toEqual(['二'])
    expect(r.fresh).toHaveLength(0)
  })

  it('새 한자 세션: 새 카드 + 오늘 배우는 중인 카드만', () => {
    const n = filterQueue(q, 'new')
    expect(n.review).toHaveLength(0)
    expect(n.learning.map((c) => c.k)).toEqual(['三'])
    expect(n.fresh.map((e) => e.k)).toEqual(['四', '五'])
  })
})
