import Dexie, { type EntityTable } from 'dexie'
import { dayKey } from './srs'
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

export async function addExtraNew(stage: Stage, n: number, dayStartHour: number) {
  const cur = await getExtraNew(dayStartHour)
  cur[stage] += n
  await setMeta('extraNew', { day: dayKey(Date.now(), dayStartHour), ...cur } satisfies ExtraNew)
}

export function withExtraNew<T extends { newPerDay: Record<Stage, number> }>(s: T, extra: Record<Stage, number>): T {
  return { ...s, newPerDay: { w: s.newPerDay.w + extra.w, r: s.newPerDay.r + extra.r } }
}
