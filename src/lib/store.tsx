import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadKanji } from './data'
import { db, getExtraNew, loadSettings, saveSettings, withExtraNew } from './db'
import { dayStart } from './srs'
import { DEFAULT_SETTINGS, type CardRow, type KanjiEntry, type LogRow, type Settings, type Stage } from './types'

interface AppData {
  kanji: KanjiEntry[] // 훈음 수정 반영됨
  byChar: Map<string, KanjiEntry>
  cards: Map<string, CardRow>
  settings: Settings
  /** 오늘 '10개 더'로 늘린 새 카드 수 */
  extraNew: Record<Stage, number>
  /** settings + 오늘 추가분 (큐 계산용) */
  studySettings: Settings
  updateSettings: (s: Settings) => Promise<void>
  /** 최근 120일 로그 (통계·오늘 카운트용) */
  recentLogs: LogRow[]
}

const Ctx = createContext<AppData | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<KanjiEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadKanji().then(setBase, (e) => setError(String(e)))
  }, [])

  const overrides = useLiveQuery(() => db.overrides.toArray(), [])
  const cardRows = useLiveQuery(() => db.cards.toArray(), [])
  const stored = useLiveQuery(() => loadSettings(), [])
  const settings = stored?.data ?? DEFAULT_SETTINGS
  const since = dayStart(Date.now(), settings.dayStartHour) - 120 * 86400000
  const extraNew = useLiveQuery(() => getExtraNew(settings.dayStartHour), [settings.dayStartHour])
  const recentLogs = useLiveQuery(() => db.logs.where('review').aboveOrEqual(since).toArray(), [since])

  const value = useMemo<AppData | null>(() => {
    if (!base || !overrides || !cardRows || !recentLogs || !extraNew) return null
    const ov = new Map(overrides.map((o) => [o.k, o.ko]))
    const kanji = ov.size ? base.map((e) => (ov.has(e.k) ? { ...e, ko: ov.get(e.k)! } : e)) : base
    return {
      kanji,
      byChar: new Map(kanji.map((e) => [e.k, e])),
      cards: new Map(cardRows.map((c) => [c.key, c])),
      settings,
      extraNew,
      studySettings: withExtraNew(settings, extraNew),
      updateSettings: saveSettings,
      recentLogs: recentLogs.filter((l) => l.rating !== 0),
    }
  }, [base, overrides, cardRows, recentLogs, settings, extraNew])

  if (error)
    return (
      <div className="center-msg">
        데이터를 불러오지 못했습니다.
        <br />
        <small>{error}</small>
      </div>
    )
  if (!value) return <div className="center-msg">불러오는 중…</div>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppDataProvider 밖에서 사용')
  return v
}
