/** 앱 아이콘 생성: KanjiVG 의 「字」 획을 주홍 배경 위에 그림 → public/*.png, favicon.svg */
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const strokes: string[] = JSON.parse(readFileSync(join(ROOT, 'public/data/strokes.json'), 'utf8'))['字']

function svg({ padding, rounded }: { padding: number; rounded: boolean }) {
  // 109×109 KanjiVG 좌표를 512 캔버스 가운데에 배치
  const inner = 512 - padding * 2
  const scale = inner / 109
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="#c8432b"/>
  <g transform="translate(${padding} ${padding}) scale(${scale})" fill="none" stroke="#fffaf3" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    ${strokes.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
</svg>`
}

const out = (f: string) => join(ROOT, 'public', f)
// 일반 아이콘 / maskable(안전 영역 확보) / 애플 터치 아이콘(iOS 가 직접 둥글게 깎음)
await sharp(Buffer.from(svg({ padding: 72, rounded: false }))).resize(192).png().toFile(out('icon-192.png'))
await sharp(Buffer.from(svg({ padding: 72, rounded: false }))).resize(512).png().toFile(out('icon-512.png'))
await sharp(Buffer.from(svg({ padding: 120, rounded: false }))).resize(512).png().toFile(out('icon-maskable-512.png'))
await sharp(Buffer.from(svg({ padding: 80, rounded: false }))).resize(180).png().toFile(out('apple-touch-icon.png'))
writeFileSync(out('favicon.svg'), svg({ padding: 64, rounded: true }))
console.log('icons written')
