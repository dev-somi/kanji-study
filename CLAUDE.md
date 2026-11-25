# CLAUDE.md

일본 상용한자 2136자를 FSRS 간격 반복으로 외우는 PWA. React 19 + Vite + TypeScript, 로컬 저장은 Dexie(IndexedDB), 동기화는 Supabase를 쓴다. 맥 브라우저와 아이폰 홈 화면 앱에서 사용한다. 사용자 설명은 [README.md](README.md)에 있다.

## 작업 규칙

- **push 전에는 반드시 사용자에게 허락을 받는다.** `main`에 push하면 GitHub Pages로 바로 배포된다([deploy.yml](.github/workflows/deploy.yml)). 커밋까지만 하고 "푸시할까요?"라고 묻는다. 이전에 받은 허락은 다음 push에 적용되지 않는다.
- 브랜치 없이 `main`에 직접 커밋한다. 커밋 메시지는 한국어 한 줄 요약으로 쓰고(예: `쓰기 힌트: 일본어 단어 뜻 추가`), 필요하면 본문에 이유를 적는다.
- 커밋 전에 `npm run lint && npm test && npm run build`를 돌린다. CI도 test와 build를 돌린다. lint에는 원래 있던 경고(store.tsx, Home.tsx, Browse.tsx)가 남아 있다.
- UI 문구는 한국어 존댓말 해요체로 쓴다(예: "한국어에서는 잘 쓰지 않는 글자예요"). 코드 주석도 한국어로 쓴다.
- 앱의 방향을 바꾸는 결정이나 해결한 문제는 [docs/](docs/)에 기록한다. 아래 "기록 남기기"를 참고한다.

## 명령

```sh
npm run dev          # http://localhost:5173
npm test             # vitest (src/lib/srs.test.ts, scripts/words.test.ts)
npm run lint         # oxlint
npm run build        # tsc -b && vite build → dist/
npm run build-data   # scripts/ 원본 → public/data/*.json (먼저 ./scripts/fetch-sources.sh)
```

## 구조

- [src/pages/Study.tsx](src/pages/Study.tsx): 학습 화면이다. 단계는 `w`(쓰기: 훈음을 보고 한자 쓰기)와 `r`(읽기: 한자를 보고 음독·훈독 떠올리기) 두 가지다. 쓰기 문제 화면의 힌트는 `hint`(획수), `wordHint`(한국어 단어), `jaHint`(일본어 단어 뜻)로 나뉘고, `advance()`가 카드를 넘길 때 모두 초기화한다.
- [src/components/Examples.tsx](src/components/Examples.tsx): 예시 단어를 보여 준다. 정답 화면에서는 전체를 보여 주고, `hint="ko" | "ja"`일 때는 문제 화면용 힌트로 한자를 숨긴 채 보여 준다.
- [src/lib/srs.ts](src/lib/srs.ts): 큐 구성과 채점(ts-fsrs). [db.ts](src/lib/db.ts): Dexie 스키마와 메타. [sync.ts](src/lib/sync.ts): Supabase 동기화. [data.ts](src/lib/data.ts): `public/data/*.json` 로더.
- `public/data/`: 미리 빌드해 커밋한 데이터다. `kanji.json`, `strokes.json`, `parts.json`, `words.json`이 있다. **손으로 고치지 말고** `scripts/` 원본을 고친 다음 `npm run build-data`로 다시 만든다.

## 데이터 원본 (scripts/)

- `scripts/korean/NN.tsv`: `한자\t훈음` (예: `日	날 일`)
- `scripts/words/ko-NN.tsv`: `한자\t한글\t한자표기`. 한글 음절과 한자 음이 맞는지 빌드 때 검사한다.
- `scripts/words/ja-NN.tsv`: `한자\t단어\t읽기(히라가나)\t한국어 뜻`. 음독마다 하나씩 넣고, 그다음 훈독 순서로 해서 최대 3개까지 넣는다. 단어와 읽기가 JMdict에 있는지 빌드 때 검사한다.
- 파일 번호 01~12는 학년이다. 01~06은 초1~초6이고, 07~12는 중1~고3이다. 중1~고3은 漢検 급수로 나눈다(README 참고).
- 외부 원본은 `data-src/`에 둔다. git에 포함하지 않으며 `./scripts/fetch-sources.sh`로 받는다.

## 기록 남기기 (docs/)

- [docs/adr/](docs/adr/): 앱의 방향이나 설계를 바꾸는 결정을 기록한다. 새 학습 방식, 데이터 구조 변경, 화면 흐름 변경 같은 것이다. `NNNN-제목.md`로 번호를 이어 붙이고, 형식은 [docs/adr/README.md](docs/adr/README.md)를 따른다.
- [docs/troubleshooting/](docs/troubleshooting/): 원인을 찾아 고친 버그나 막혔던 문제를 기록한다. 증상, 원인, 해결, 관련 커밋을 적는다.
- 기능 추가나 버그 수정을 커밋할 때 해당 문서도 같은 커밋에 넣는다. 오타 수정이나 단어 데이터 추가 같은 사소한 변경은 기록하지 않는다.
