import { splitKun } from '../lib/data'
import type { KanjiEntry } from '../lib/types'

/** 음독·훈독·특수 읽기 표시 */
export function Readings({ e, compact }: { e: KanjiEntry; compact?: boolean }) {
  return (
    <div className={`readings ${compact ? 'compact' : ''}`} lang="ja">
      {e.on.length > 0 && (
        <div className="reading-row">
          <span className="reading-label" lang="ko">
            음
          </span>
          <div className="chips">
            {e.on.map((r) => (
              <span key={r} className="chip on">
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
      {e.kun.length > 0 && (
        <div className="reading-row">
          <span className="reading-label" lang="ko">
            훈
          </span>
          <div className="chips">
            {e.kun.map((r) => {
              const { stem, okuri } = splitKun(r)
              return (
                <span key={r} className="chip kun">
                  {stem}
                  {okuri && <span className="okuri">{okuri}</span>}
                </span>
              )
            })}
          </div>
        </div>
      )}
      {e.sp.length > 0 && (
        <div className="reading-row">
          <span className="reading-label" lang="ko" title="특정 단어에서만 쓰는 읽기">
            특수
          </span>
          <div className="chips">
            {e.sp.map((r) => {
              const { stem, okuri } = splitKun(r)
              return (
                <span key={r} className="chip sp">
                  {stem}
                  {okuri && <span className="okuri">{okuri}</span>}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
