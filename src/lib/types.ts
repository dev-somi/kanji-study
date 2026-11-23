export interface KanjiEntry {
  id: number // 학습 순서
  k: string // 신자체 (일본 현행 글자)
  old?: string // 旧字体 (한국 정자와 대부분 일치)
  g: number // 학년 1~6 = 초1~초6, 7~12 = 중1~고3
  s: number // 총획수
  on: string[] // 음독
  kun: string[] // 훈독 ('-' 뒤가 送り仮名)
  sp: string[] // 특수·드문 읽기
  ko: string // 한국어 훈음
  en: string
}

/** w = 1단계 쓰기 (훈음 → 한자), r = 2단계 읽기 (한자 → 음독·훈독) */
export type Stage = 'w' | 'r'
export const STAGES: Stage[] = ['w', 'r']
export const STAGE_LABEL: Record<Stage, string> = { w: '쓰기', r: '읽기' }

/** IndexedDB에 저장하는 카드 상태 (FSRS Card + 메타). 날짜는 모두 epoch ms */
export interface CardRow {
  key: string // `${k}:${stage}`
  k: string
  stage: Stage
  due: number
  stability: number
  difficulty: number
  scheduled_days: number
  reps: number
  lapses: number
  learning_steps: number
  state: number // ts-fsrs State
  last_review: number | null
  updated_at: number
  dirty: 0 | 1 // 서버에 아직 안 올라감
}

export interface LogRow {
  id: string // uuid
  k: string
  stage: Stage
  rating: number // 1~4
  state: number // 채점 직전 상태 (0 = 새 카드)
  review: number // 채점 시각
  updated_at: number
  dirty: 0 | 1
}

export interface OverrideRow {
  k: string
  ko: string // 사용자가 고친 훈음
  updated_at: number
  dirty: 0 | 1
}

export interface Settings {
  newPerDay: Record<Stage, number>
  maxReviewsPerDay: number
  retention: number // FSRS 목표 기억률
  /** auto: 쓰기 카드가 충분히 익으면(안정도 ≥ 7일) 읽기 카드 오픈 / all: 처음부터 전부 */
  readUnlock: 'auto' | 'all'
  dayStartHour: number // 하루가 바뀌는 시각 (기본 새벽 4시)
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: { w: 20, r: 20 },
  maxReviewsPerDay: 300,
  retention: 0.9,
  readUnlock: 'auto',
  dayStartHour: 4,
}

/** 읽기 카드가 열리는 쓰기 카드의 안정도(일) */
export const READ_UNLOCK_STABILITY = 7
/** '숙달'로 보는 안정도(일) */
export const MATURE_STABILITY = 21
