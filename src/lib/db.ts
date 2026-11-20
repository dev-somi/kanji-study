import Dexie, { type EntityTable } from 'dexie'
import { DEFAULT_SETTINGS, type CardRow, type LogRow, type OverrideRow, type Settings } from './types'

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
