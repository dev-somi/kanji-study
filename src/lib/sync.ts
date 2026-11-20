/**
 * Supabase 동기화 (오프라인 우선).
 *  - 모든 데이터는 IndexedDB 에 먼저 쓰고 dirty=1 로 표시
 *  - sync(): dirty 항목 push → 서버에서 마지막 pull 이후 바뀐 항목 pull → updated_at 이 더 최신인 쪽 채택
 *  - 서버 테이블은 sync_items 하나 (kind: card | log | override | settings). supabase/schema.sql 참고
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { db, getMeta, loadSettings, mergeSettings, setMeta, type StoredSettings } from './db'
import type { CardRow, LogRow, OverrideRow } from './types'

type Kind = 'card' | 'log' | 'override' | 'settings'
interface Item {
  kind: Kind
  id: string
  data: unknown
  updated_at: number
}

// ---------- 클라이언트 ----------
export interface SupabaseConfig {
  url: string
  anonKey: string
}

const CONFIG_KEY = 'kanji-study:supabase'

export function getConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (url && anonKey) return { url, anonKey }
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? (JSON.parse(raw) as SupabaseConfig) : null
  } catch {
    return null
  }
}

export function isConfigBuiltIn() {
  return !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export function setConfig(c: SupabaseConfig | null) {
  try {
    if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
    else localStorage.removeItem(CONFIG_KEY)
  } catch {
    /* 저장 불가 환경 */
  }
  client = null
}

let client: SupabaseClient | null = null
export function supabase(): SupabaseClient | null {
  if (client) return client
  const c = getConfig()
  if (!c) return null
  client = createClient(c.url, c.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  return client
}

export async function getSession(): Promise<Session | null> {
  const sb = supabase()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  return data.session
}

export async function signIn(email: string, password: string) {
  const sb = supabase()
  if (!sb) throw new Error('Supabase 설정이 없습니다')
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUp(email: string, password: string) {
  const sb = supabase()
  if (!sb) throw new Error('Supabase 설정이 없습니다')
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) throw error
  return { needsConfirm: !data.session }
}

export async function signOut() {
  await supabase()?.auth.signOut()
  await setMeta('lastPull', null)
}

// ---------- 상태 알림 ----------
export type SyncStatus = { state: 'off' | 'idle' | 'syncing' | 'error'; message?: string; at?: number }
let status: SyncStatus = { state: 'off' }
const listeners = new Set<(s: SyncStatus) => void>()
function setStatus(s: SyncStatus) {
  status = s
  listeners.forEach((l) => l(s))
}
export function onSyncStatus(fn: (s: SyncStatus) => void) {
  listeners.add(fn)
  fn(status)
  return () => {
    listeners.delete(fn)
  }
}

// ---------- push / pull ----------
const CHUNK = 500
const PULL_OVERLAP_MS = 5 * 60 * 1000 // 동시 커밋 누락 방지용 겹침 구간

async function collectDirty(): Promise<Item[]> {
  const items: Item[] = []
  const cards = await db.cards.where('dirty').equals(1).toArray()
  for (const c of cards) {
    const { dirty: _d, ...data } = c
    items.push({ kind: 'card', id: c.key, data, updated_at: c.updated_at })
  }
  const logs = await db.logs.where('dirty').equals(1).toArray()
  for (const l of logs) {
    const { dirty: _d, ...data } = l
    items.push({ kind: 'log', id: l.id, data, updated_at: l.updated_at })
  }
  const ovs = await db.overrides.where('dirty').equals(1).toArray()
  for (const o of ovs) {
    const { dirty: _d, ...data } = o
    items.push({ kind: 'override', id: o.k, data, updated_at: o.updated_at })
  }
  const s = await loadSettings()
  if (s.dirty) items.push({ kind: 'settings', id: 'settings', data: s.data, updated_at: s.updated_at })
  return items
}

async function markClean(items: Item[]) {
  await db.transaction('rw', [db.cards, db.logs, db.overrides, db.meta], async () => {
    for (const it of items) {
      // push 하는 사이에 다시 바뀐 항목은 dirty 유지
      if (it.kind === 'card') {
        const cur = await db.cards.get(it.id)
        if (cur && cur.updated_at === it.updated_at) await db.cards.update(it.id, { dirty: 0 })
      } else if (it.kind === 'log') {
        await db.logs.update(it.id, { dirty: 0 })
      } else if (it.kind === 'override') {
        const cur = await db.overrides.get(it.id)
        if (cur && cur.updated_at === it.updated_at) await db.overrides.update(it.id, { dirty: 0 })
      } else if (it.kind === 'settings') {
        const cur = await loadSettings()
        if (cur.updated_at === it.updated_at) await setMeta('settings', { ...cur, dirty: 0 })
      }
    }
  })
}

async function applyRemote(items: Item[]) {
  await db.transaction('rw', [db.cards, db.logs, db.overrides, db.meta], async () => {
    for (const it of items) {
      if (it.kind === 'card') {
        const cur = await db.cards.get(it.id)
        if (!cur || cur.updated_at < it.updated_at) await db.cards.put({ ...(it.data as CardRow), dirty: 0 })
      } else if (it.kind === 'log') {
        if (!(await db.logs.get(it.id))) await db.logs.put({ ...(it.data as LogRow), dirty: 0 })
      } else if (it.kind === 'override') {
        const cur = await db.overrides.get(it.id)
        if (!cur || cur.updated_at < it.updated_at) await db.overrides.put({ ...(it.data as OverrideRow), dirty: 0 })
      } else if (it.kind === 'settings') {
        const cur = await getMeta<StoredSettings | null>('settings', null)
        if (!cur || cur.updated_at < it.updated_at)
          await setMeta('settings', {
            data: mergeSettings(it.data as StoredSettings['data']),
            updated_at: it.updated_at,
            dirty: 0,
          } satisfies StoredSettings)
      }
    }
  })
}

let running: Promise<void> | null = null

export function sync(): Promise<void> {
  running ??= doSync().finally(() => {
    running = null
  })
  return running
}

async function doSync() {
  const sb = supabase()
  if (!sb) return setStatus({ state: 'off' })
  const session = await getSession()
  if (!session) return setStatus({ state: 'off' })
  if (!navigator.onLine) return setStatus({ state: 'error', message: '오프라인' })

  setStatus({ state: 'syncing' })
  try {
    // push
    const dirty = await collectDirty()
    for (let i = 0; i < dirty.length; i += CHUNK) {
      const chunk = dirty.slice(i, i + CHUNK)
      const { error } = await sb.rpc('push_items', { items: chunk })
      if (error) throw error
      await markClean(chunk)
    }

    // pull (synced_at 기준 페이지네이션)
    const lastPull = await getMeta<string | null>('lastPull', null)
    let cursor = lastPull ? new Date(new Date(lastPull).getTime() - PULL_OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z'
    let newest = lastPull
    for (;;) {
      const { data, error } = await sb
        .from('sync_items')
        .select('kind,id,data,updated_at,synced_at')
        .gt('synced_at', cursor)
        .order('synced_at', { ascending: true })
        .limit(1000)
      if (error) throw error
      if (!data.length) break
      await applyRemote(data as (Item & { synced_at: string })[])
      cursor = data[data.length - 1].synced_at
      newest = cursor
      if (data.length < 1000) break
    }
    if (newest) await setMeta('lastPull', newest)
    setStatus({ state: 'idle', at: Date.now() })
  } catch (e) {
    console.error('sync failed', e)
    setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined
/** 채점 직후 등: 몇 초 모아서 동기화 */
export function scheduleSync(delay = 4000) {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void sync(), delay)
}

/** 앱 시작 시 한 번: 포커스/온라인 복귀 때 자동 동기화 */
let autoStarted = false
export function startAutoSync() {
  void sync()
  if (autoStarted) return
  autoStarted = true
  window.addEventListener('online', () => void sync())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync()
    else if (document.visibilityState === 'hidden') void sync() // 앱을 닫기 전에 올려두기
  })
  supabase()?.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') void sync()
    if (event === 'SIGNED_OUT') setStatus({ state: 'off' })
  })
}
