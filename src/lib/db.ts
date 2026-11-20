import Dexie, { type EntityTable } from 'dexie'
import { dayKey, dayStart, todayCounts } from './srs'
import { DEFAULT_SETTINGS, type CardRow, type LogRow, type OverrideRow, type Settings, type Stage } from './types'

interface MetaRow {
  key: string
  value: unknown
}

export const db = new Dexie('kanji-study') as Dexie & {
  cards: EntityTable<CardRow, 'key'>
  logs: EntityTable<LogRow, 'id'>
  overrides: EntityTable<OverrideRow, 'k'>
  meta: EntityTable<MetaRow, 'key'>
}

db.version(1).stores({
  cards: 'key, k, stage, due, dirty',
  logs: 'id, review, stage, dirty',
  overrides: 'k, dirty',
  meta: 'key',
})

// ---------- meta helpers ----------
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

// ---------- settings (동기화 대상) ----------
export interface StoredSettings {
  data: Settings
  updated_at: number
  dirty: 0 | 1
}

export function mergeSettings(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    newPerDay: { ...DEFAULT_SETTINGS.newPerDay, ...(s?.newPerDay ?? {}) },
  }
}

export async function loadSettings(): Promise<StoredSettings> {
  const s = await getMeta<StoredSettings | null>('settings', null)
  return s ? { ...s, data: mergeSettings(s.data) } : { data: DEFAULT_SETTINGS, updated_at: 0, dirty: 0 }
}

export async function saveSettings(data: Settings) {
  await setMeta('settings', { data, updated_at: Date.now(), dirty: 1 } satisfies StoredSettings)
}

// ---------- 오늘만 추가한 새 카드 수 ("10개 더") ----------

interface ExtraNew {
  day: string
  w: number
  r: number
}

/** 오늘 추가로 늘린 새 카드 수. 날짜가 바뀌면 0 */
export async function getExtraNew(dayStartHour: number): Promise<Record<Stage, number>> {
  const v = await getMeta<ExtraNew | null>('extraNew', null)
  const today = dayKey(Date.now(), dayStartHour)
  return v && v.day === today ? { w: v.w, r: v.r } : { w: 0, r: 0 }
}

/**
 * '10개 더': 오늘 이미 배운 새 카드 수(다른 기기에서 배운 것 포함)에서 n개 더 할 수 있게 한도를 올린다.
 * (추가분은 기기마다 따로 저장되지만 배운 기록은 동기화되므로, 단순히 +n 하면
 *  다른 기기에서 많이 배운 날엔 여러 번 눌러야 카드가 나왔음)
 */
export async function addExtraNew(stage: Stage, n: number, dayStartHour: number) {
  const now = Date.now()
  const [cur, settings, logs] = await Promise.all([
    getExtraNew(dayStartHour),
    loadSettings(),
    db.logs.where('review').aboveOrEqual(dayStart(now, dayStartHour)).toArray(),
  ])
  const base = settings.data.newPerDay[stage]
  const { newDone } = todayCounts(logs, stage, now, dayStartHour)
  cur[stage] = Math.max(base + cur[stage], newDone) + n - base
  await setMeta('extraNew', { day: dayKey(Date.now(), dayStartHour), ...cur } satisfies ExtraNew)
}

export function withExtraNew<T extends { newPerDay: Record<Stage, number> }>(s: T, extra: Record<Stage, number>): T {
  return { ...s, newPerDay: { w: s.newPerDay.w + extra.w, r: s.newPerDay.r + extra.r } }
}
