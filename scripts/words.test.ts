import { describe, expect, it } from 'vitest'
import { checkJa, checkKo, initialLaw, soundsOfKo, type JmIndex } from './words'

const SOUNDS: Record<string, string[]> = {
  學: ['학'],
  学: ['학'],
  校: ['교'],
  生: ['생'],
  力: ['력'],
  女: ['녀'],
  比: ['비'],
  率: ['솔', '률'],
  六: ['륙', '육'],
}
const soundsOf = (c: string) => SOUNDS[c] ?? []

describe('initialLaw', () => {
  it('ㄹ·ㄴ 첫소리를 바꾼다', () => {
    expect(initialLaw('력')).toBe('역')
    expect(initialLaw('녀')).toBe('여')
    expect(initialLaw('로')).toBe('노')
    expect(initialLaw('학')).toBe('학')
  })
})

describe('soundsOfKo', () => {
  it('훈음에서 음만 꺼낸다', () => {
    expect(soundsOfKo('배울 학')).toEqual(['학'])
    expect(soundsOfKo('비율 률, 거느릴 솔')).toEqual(['률', '솔'])
  })
})

describe('checkKo', () => {
  it('정자로 쓴 단어도 통과', () => {
    expect(checkKo(['学', '學'], ['학교', '學校'], soundsOf)).toBeUndefined()
  })
  it('두음법칙·모음 뒤 률→율 허용', () => {
    expect(checkKo(['力'], ['역량', '力量'], soundsOf)).toBeUndefined()
    expect(checkKo(['率'], ['비율', '比率'], soundsOf)).toBeUndefined()
    expect(checkKo(['女'], ['여자', '女子'], soundsOf)).toBeUndefined()
  })
  it('대상 글자가 없거나 음이 틀리면 실패', () => {
    expect(checkKo(['学'], ['교생', '校生'], soundsOf)).toMatch('대상 글자')
    expect(checkKo(['学', '學'], ['악교', '學校'], soundsOf)).toMatch('음 불일치')
    expect(checkKo(['学', '學'], ['학', '學校'], soundsOf)).toMatch('글자 수')
  })
})

describe('checkJa', () => {
  const jm: JmIndex = new Map([
    ['学校', { readings: new Map([['がっこう', true]]) }],
    ['学舎', { readings: new Map([['がくしゃ', false]]) }],
  ])
  it('JMdict와 대조', () => {
    expect(checkJa(['学'], ['学校', 'がっこう', '학교'], jm)).toEqual({})
    expect(checkJa(['学'], ['学校', 'がくこう', '학교'], jm).error).toMatch('읽기 다름')
    expect(checkJa(['学'], ['学園', 'がくえん', '학원'], jm).error).toMatch('없는')
    expect(checkJa(['学'], ['学舎', 'がくしゃ', '학사'], jm).warn).toBeTruthy()
    expect(checkJa(['学'], ['校舎', 'こうしゃ', '교사'], jm).error).toMatch('대상 글자')
  })
})

describe('사이시옷', () => {
  it('숫자(數字)', () => {
    expect(checkKo(['字'], ['숫자', '數字'], (c) => ({ 數: ['수'], 字: ['자'] })[c] ?? [])).toBeUndefined()
  })
})
