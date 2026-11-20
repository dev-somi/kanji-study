import { useEffect, useState } from 'react'
import { Browse } from './pages/Browse'
import { Home } from './pages/Home'
import { Settings } from './pages/Settings'
import { Study } from './pages/Study'
import { AppDataProvider } from './lib/store'
import { startAutoSync } from './lib/sync'
import type { StudyMode } from './lib/srs'
import type { Stage } from './lib/types'

type Route = { name: 'home' } | { name: 'study'; stage: Stage; mode: StudyMode } | { name: 'browse' } | { name: 'settings' }

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  const m = h.match(/^study\/([wr])\/(review|new)$/)
  if (m) return { name: 'study', stage: m[1] as Stage, mode: m[2] as StudyMode }
  if (h === 'browse') return { name: 'browse' }
  if (h === 'settings') return { name: 'settings' }
  return { name: 'home' }
}

function go(path: string) {
  location.hash = `#/${path}`
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    startAutoSync()
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.name])

  return (
    <AppDataProvider>
      {route.name === 'study' ? (
        <Study key={`${route.stage}-${route.mode}`} stage={route.stage} mode={route.mode} onExit={() => go('')} />
      ) : (
        <div className="shell">
          <div className="content">
            {route.name === 'home' && <Home onStudy={(s, m) => go(`study/${s}/${m}`)} onSettings={() => go('settings')} />}
            {route.name === 'browse' && <Browse />}
            {route.name === 'settings' && <Settings />}
          </div>
          <nav className="tabbar">
            <TabLink active={route.name === 'home'} onClick={() => go('')} icon="⌂" label="홈" />
            <TabLink active={route.name === 'browse'} onClick={() => go('browse')} icon="字" label="목록" />
            <TabLink active={route.name === 'settings'} onClick={() => go('settings')} icon="⚙" label="설정" />
          </nav>
        </div>
      )}
    </AppDataProvider>
  )
}

function TabLink({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button className={`tab ${active ? 'on' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <span className="tab-icon" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  )
}
