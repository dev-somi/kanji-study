import { useEffect, useRef, useState } from 'react'
import { exportBackup, importBackup } from '../lib/repo'
import { useAppData } from '../lib/store'
import {
  getConfig,
  getSession,
  isConfigBuiltIn,
  onSyncStatus,
  setConfig,
  signIn,
  signOut,
  signUp,
  startAutoSync,
  sync,
  type SyncStatus,
} from '../lib/sync'
import type { Settings as S } from '../lib/types'

export function Settings() {
  const { settings, updateSettings } = useAppData()
  const set = (patch: Partial<S>) => void updateSettings({ ...settings, ...patch })

  return (
    <div className="page settings">
      <h1>설정</h1>

      <section className="panel">
        <h2>학습량</h2>
        <NumberRow
          label="하루 새 카드 — 쓰기"
          value={settings.newPerDay.w}
          min={0}
          max={200}
          onChange={(v) => set({ newPerDay: { ...settings.newPerDay, w: v } })}
        />
        <NumberRow
          label="하루 새 카드 — 읽기"
          value={settings.newPerDay.r}
          min={0}
          max={200}
          onChange={(v) => set({ newPerDay: { ...settings.newPerDay, r: v } })}
        />
        <NumberRow
          label="하루 최대 복습 (단계별)"
          value={settings.maxReviewsPerDay}
          min={10}
          max={2000}
          step={10}
          onChange={(v) => set({ maxReviewsPerDay: v })}
        />
        <p className="muted small">
          2136자를 하루 20자씩이면 약 107일. 새 카드 1장은 이후 며칠간 복습 몇 번을 부르니, 복습이 쌓이면 새 카드를 줄이세요.
        </p>
      </section>

      <section className="panel">
        <h2>복습 알고리즘 (FSRS)</h2>
        <label className="row-field">
          <span>목표 기억률</span>
          <select value={settings.retention} onChange={(e) => set({ retention: Number(e.target.value) })}>
            {[0.8, 0.85, 0.9, 0.93, 0.95].map((r) => (
              <option key={r} value={r}>
                {Math.round(r * 100)}%{r === 0.9 ? ' (권장)' : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">높일수록 덜 잊지만 복습이 많아져요.</p>
        <label className="row-field">
          <span>2단계(읽기) 카드 열기</span>
          <select value={settings.readUnlock} onChange={(e) => set({ readUnlock: e.target.value as S['readUnlock'] })}>
            <option value="auto">쓰기가 익은 한자부터 (권장)</option>
            <option value="all">처음부터 전부</option>
          </select>
        </label>
        <label className="row-field">
          <span>하루가 바뀌는 시각</span>
          <select value={settings.dayStartHour} onChange={(e) => set({ dayStartHour: Number(e.target.value) })}>
            {[0, 2, 3, 4, 5, 6].map((h) => (
              <option key={h} value={h}>
                새벽 {h}시
              </option>
            ))}
          </select>
        </label>
      </section>

      <SyncPanel />

      <BackupPanel />

      <section className="panel">
        <h2>사용 팁</h2>
        <ul className="tips small">
          <li>맥: <kbd>Space</kbd> 정답 보기 · <kbd>1</kbd>~<kbd>4</kbd> 채점 · <kbd>⌘Z</kbd> 획/채점 되돌리기 · <kbd>Esc</kbd> 나가기</li>
          <li>아이폰: Safari에서 열고 공유 → <b>홈 화면에 추가</b>하면 앱처럼 쓸 수 있어요. 오프라인에서도 됩니다.</li>
          <li>화면 대신 종이에 써도 돼요. 정답을 보고 스스로 채점하면 됩니다.</li>
          <li>‘알맞음’이 기본. 틀렸으면 ‘다시’, 겨우 맞혔으면 ‘어려움’, 너무 쉬우면 ‘쉬움’.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>정보</h2>
        <p className="small muted">
          상용한자표(2010) 2136자 · 음훈은 문화청 상용한자표 기준(위키백과 「常用漢字一覧」, CC BY-SA). 획순: KanjiVG (Ulrich Apel, CC BY-SA 3.0). 빈도·영어
          뜻: KANJIDIC2 (EDRDG, CC BY-SA 4.0). 한국어 훈음은 자동 작성 후 대조 검수 — 틀린 곳은 목록에서 직접 고칠 수 있어요.
        </p>
      </section>
    </div>
  )
}

function NumberRow(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const { label, value, min, max, step = 1, onChange } = props
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <div className="row-field">
      <span>{label}</span>
      <div className="stepper">
        <button onClick={() => onChange(clamp(value - (step === 1 ? 5 : step)))} aria-label="줄이기">
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        />
        <button onClick={() => onChange(clamp(value + (step === 1 ? 5 : step)))} aria-label="늘리기">
          +
        </button>
      </div>
    </div>
  )
}

function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus>({ state: 'off' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState(() => getConfig())
  const [cfgUrl, setCfgUrl] = useState(cfg?.url ?? '')
  const [cfgKey, setCfgKey] = useState(cfg?.anonKey ?? '')

  useEffect(() => onSyncStatus(setStatus), [])
  useEffect(() => {
    void getSession().then((s) => setUser(s?.user.email ?? null))
  }, [cfg, status.state])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h2>맥 ↔ 아이폰 동기화</h2>
      {!cfg ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            const c = { url: cfgUrl.trim(), anonKey: cfgKey.trim() }
            setConfig(c)
            setCfg(c)
            startAutoSync()
          }}
        >
          <p className="muted small">Supabase 프로젝트의 URL과 anon key를 넣으면 기기 간 동기화가 켜져요. (README 참고)</p>
          <input placeholder="https://xxxx.supabase.co" value={cfgUrl} onChange={(e) => setCfgUrl(e.target.value)} />
          <input placeholder="anon public key" value={cfgKey} onChange={(e) => setCfgKey(e.target.value)} />
          <button className="btn primary" disabled={!cfgUrl || !cfgKey}>
            저장
          </button>
        </form>
      ) : user ? (
        <div className="stack">
          <div className="row-field">
            <span>
              로그인: <b>{user}</b>
            </span>
          </div>
          <div className="muted small">
            상태:{' '}
            {status.state === 'syncing'
              ? '동기화 중…'
              : status.state === 'error'
                ? `오류 — ${status.message}`
                : status.at
                  ? `마지막 동기화 ${new Date(status.at).toLocaleTimeString()}`
                  : '대기'}
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => run(sync)}>
              지금 동기화
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await signOut()
                  setUser(null)
                })
              }
            >
              로그아웃
            </button>
          </div>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await signIn(email, password)
              setUser(email)
              await sync()
            })
          }}
        >
          <p className="muted small">맥과 아이폰에서 같은 계정으로 로그인하세요. 로그인 안 해도 이 기기에서는 그대로 쓸 수 있어요.</p>
          <input type="email" autoComplete="username" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="비밀번호 (6자 이상)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <div className="row">
            <button className="btn primary grow" disabled={busy}>
              로그인
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || !email || password.length < 6}
              onClick={() =>
                run(async () => {
                  const { needsConfirm } = await signUp(email, password)
                  if (needsConfirm) setMsg('확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인하세요.')
                  else {
                    setUser(email)
                    await sync()
                  }
                })
              }
            >
              가입
            </button>
          </div>
        </form>
      )}
      {msg && <p className="small notice">{msg}</p>}
      {cfg && !isConfigBuiltIn() && (
        <button
          className="link-btn small"
          onClick={() => {
            setConfig(null)
            setCfg(null)
          }}
        >
          Supabase 설정 변경
        </button>
      )}
    </section>
  )
}

function BackupPanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <section className="panel">
      <h2>백업</h2>
      <div className="row">
        <button
          className="btn"
          onClick={async () => {
            const blob = await exportBackup()
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `kanji-study-${new Date().toISOString().slice(0, 10)}.json`
            a.click()
            setTimeout(() => URL.revokeObjectURL(a.href), 1000)
          }}
        >
          내보내기
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          가져오기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              await importBackup(f)
              setMsg('가져왔어요.')
            } catch (err) {
              setMsg(err instanceof Error ? err.message : String(err))
            }
            e.target.value = ''
          }}
        />
      </div>
      {msg && <p className="small notice">{msg}</p>}
    </section>
  )
}
