import { db, getMeta, loadSettings, setMeta, type StoredSettings } from './db'
import { cardKey, review, type Grade } from './srs'
import { scheduleSync } from './sync'
import type { CardRow, LogRow, OverrideRow, Stage } from './types'

export interface UndoToken {
  key: string
  prev: CardRow | undefined
  logId: string
}

export async function gradeCard(k: string, stage: Stage, grade: Grade, retention: number): Promise<UndoToken> {
  const key = cardKey(k, stage)
  const now = Date.now()
  let token!: UndoToken
  await db.transaction('rw', db.cards, db.logs, async () => {
    const prev = await db.cards.get(key)
    const { row, log } = review(prev, k, stage, grade, now, retention)
    await db.cards.put(row)
    await db.logs.put(log)
    token = { key, prev, logId: log.id }
  })
  scheduleSync()
  return token
}

/** 방금 채점 되돌리기. (이미 서버에 올라간 로그는 다음 동기화 때 다시 내려오지 않도록 무효 표시) */
export async function undoGrade(t: UndoToken) {
  const now = Date.now()
  await db.transaction('rw', db.cards, db.logs, async () => {
    if (t.prev) await db.cards.put({ ...t.prev, updated_at: now, dirty: 1 })
    else {
      // 새 카드였으면 삭제 대신 state=New 로 저장 (삭제하면 서버에 남은 카드가 다음 pull 때 되살아남)
      await db.cards.put({
        key: t.key,
        k: t.key.split(':')[0],
        stage: t.key.split(':')[1] as Stage,
        due: now,
        stability: 0,
        difficulty: 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        learning_steps: 0,
        state: 0,
        last_review: null,
        updated_at: now,
        dirty: 1,
      })
    }
    const log = await db.logs.get(t.logId)
    if (log) await db.logs.put({ ...log, rating: 0, updated_at: now, dirty: 1 }) // rating 0 = 취소됨
  })
  scheduleSync()
}

export async function resetCard(k: string, stage: Stage) {
  const key = cardKey(k, stage)
  const now = Date.now()
  const cur = await db.cards.get(key)
  if (!cur) return
  await db.cards.put({
    ...cur,
    due: now,
    stability: 0,
    difficulty: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    state: 0,
    last_review: null,
    updated_at: now,
    dirty: 1,
  })
  scheduleSync()
}

export async function setOverride(k: string, ko: string) {
  await db.overrides.put({ k, ko: ko.trim(), updated_at: Date.now(), dirty: 1 })
  scheduleSync()
}

// ---------- 백업 ----------
interface Backup {
  app: 'kanji-study'
  version: 1
  exportedAt: string
  cards: CardRow[]
  logs: LogRow[]
  overrides: OverrideRow[]
  settings: StoredSettings | null
}

export async function exportBackup(): Promise<Blob> {
  const data: Backup = {
    app: 'kanji-study',
    version: 1,
    exportedAt: new Date().toISOString(),
    cards: await db.cards.toArray(),
    logs: await db.logs.toArray(),
    overrides: await db.overrides.toArray(),
    settings: await getMeta<StoredSettings | null>('settings', null),
  }
  return new Blob([JSON.stringify(data)], { type: 'application/json' })
}

export async function importBackup(file: File) {
  const data = JSON.parse(await file.text()) as Backup
  if (data.app !== 'kanji-study') throw new Error('이 앱의 백업 파일이 아닙니다')
  await db.transaction('rw', [db.cards, db.logs, db.overrides, db.meta], async () => {
    // 더 최신인 것만 반영 + 서버로 다시 올리도록 dirty
    for (const c of data.cards) {
      const cur = await db.cards.get(c.key)
      if (!cur || cur.updated_at < c.updated_at) await db.cards.put({ ...c, dirty: 1 })
    }
    for (const l of data.logs) if (!(await db.logs.get(l.id))) await db.logs.put({ ...l, dirty: 1 })
    for (const o of data.overrides) {
      const cur = await db.overrides.get(o.k)
      if (!cur || cur.updated_at < o.updated_at) await db.overrides.put({ ...o, dirty: 1 })
    }
    if (data.settings) {
      const cur = await loadSettings()
      if (cur.updated_at < data.settings.updated_at) await setMeta('settings', { ...data.settings, dirty: 1 })
    }
  })
  scheduleSync(0)
}
