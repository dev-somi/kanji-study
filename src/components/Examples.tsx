import { useEffect, useState } from 'react'
import { loadWords, type WordsData } from '../lib/data'

const OPEN_KEY = 'kanji-study:examples-open'
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

/** 단어 안의 대상 글자를 굵게 */
function Hit({ word, targets }: { word: string; targets: string[] }) {
  return (
    <>
      {[...word].map((c, i) =>
        targets.includes(c) ? (
          <b key={i} className="ex-hit">
            {c}
          </b>
        ) : (
          c
        ),
      )}
    </>
  )
}

/**
 * 예시 단어: 한국어 한자어(학교 學校)와 일본어 단어(学校 がっこう 학교).
 * hangulOnly: 쓰기 단계 힌트 — 한자를 드러내지 않도록 한국어 단어의 한글만 보여 줌
 */
export function Examples({
  k,
  old,
  hangulOnly = false,
  collapsible = false,
}: {
  k: string
  old?: string
  hangulOnly?: boolean
  collapsible?: boolean
}) {
  const [data, setData] = useState<WordsData | null>(null)
  const [open, setOpen] = useState(() => (collapsible ? readOpen() : true))

  useEffect(() => {
    let alive = true
    loadWords().then((d) => alive && setData(d), () => {})
    return () => {
      alive = false
    }
  }, [])

  const words = data?.[k]
  if (!data) return null

  if (hangulOnly) {
    const list = words?.ko ?? []
    return (
      <div className="prompt-hint examples-hint" lang="ko">
        {list.length ? list.map(([h]) => h).join(' · ') : '한국어에서는 잘 쓰지 않는 글자예요'}
      </div>
    )
  }
  if (!words || (!words.ko.length && !words.ja.length)) return null

  const targets = old ? [k, old] : [k]
  const toggleOpen = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1')
      } catch {
        /* 저장 불가 */
      }
      return !o
    })
  }

  const header = (
    <div className="structure-head">
      <span className="section-title">예시 단어</span>
      {!open && (
        <span className="muted small" lang="ko">
          {words.ko.map(([h]) => h).join(' · ')}
        </span>
      )}
      {collapsible && (
        <span className="chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      )}
    </div>
  )

  return (
    <section className="structure examples">
      {collapsible ? (
        <button className="structure-toggle" onClick={toggleOpen} aria-expanded={open}>
          {header}
        </button>
      ) : (
        header
      )}
      {open && (
        <>
          {words.ko.length > 0 && (
            <div className="ex-group">
              <div className="fact-label">한국어</div>
              <ul className="ex-list">
                {words.ko.map(([h, w]) => (
                  <li key={w} className="ex-row">
                    <span className="ex-main" lang="ko">
                      {h}
                    </span>
                    <span className="ex-sub" lang="ko">
                      <Hit word={w} targets={targets} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {words.ja.length > 0 && (
            <div className="ex-group">
              <div className="fact-label">일본어</div>
              <ul className="ex-list">
                {words.ja.map(([w, r, m]) => (
                  <li key={w + r} className="ex-row">
                    <span className="ex-main" lang="ja">
                      <Hit word={w} targets={targets} />
                    </span>
                    <span className="ex-sub" lang="ja">
                      {r}
                    </span>
                    <span className="ex-mean">{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
