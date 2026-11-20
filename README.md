# 상용한자 2136

일본 상용한자 2136자를 간격 반복(FSRS)으로 외우는 PWA 웹앱. 맥 브라우저와 아이폰 홈 화면 앱에서 사용하고, Supabase로 학습 기록을 동기화한다.

- **1단계 · 쓰기**: 한국어 훈음(예: `배울 학`)을 보고 화면이나 종이에 한자를 쓴 뒤, 정답과 획순을 보고 스스로 채점
- **2단계 · 읽기**: 한자를 보고 음독·훈독을 떠올린 뒤 스스로 채점. 쓰기 카드가 익은 한자(다음 복습이 7일 이상 남음)부터 차례로 열림
- 학습 순서: 교육한자 1학년 → 6학년 → 중학 이상. 같은 학년 안에서는 자주 쓰는 순서
- 채점 버튼 4개(다시/어려움/알맞음/쉬움). 각 버튼 위에 다음 복습까지 남은 시간이 표시됨
- 오프라인에서도 동작하며, 학습 기록은 기기에 먼저 저장되고 온라인일 때 동기화됨

## 개발

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # 스케줄러 단위 테스트
npm run build      # dist/
```

## 동기화 설정 (Supabase, 무료)

1. https://supabase.com 에서 프로젝트 생성
2. **SQL Editor**에 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여넣고 Run
3. **Authentication → Sign In / Providers → Email**: 혼자 쓴다면 *Confirm email* 을 끄면 가입 즉시 로그인됨
4. **Project Settings → API**에서 `Project URL`, `anon public` 키 복사
5. 다음 둘 중 하나:
   - 배포 빌드에 넣기: GitHub 저장소 → Settings → Secrets and variables → Actions → **Variables**에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록 (anon 키는 공개돼도 되는 키. 데이터는 RLS로 본인 것만 접근 가능)
   - 또는 앱 **설정 → 동기화**에 직접 입력 (기기마다 한 번)
6. 맥과 아이폰에서 같은 이메일/비밀번호로 로그인

## 배포 (GitHub Pages)

`main`에 push하면 `.github/workflows/deploy.yml`이 빌드·배포한다. 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정해야 한다.

## 아이폰에 설치

Safari로 배포 주소를 연 뒤 공유 버튼 → **홈 화면에 추가**. 홈 화면 앱은 Safari와 저장소가 분리되어 있으므로 **설치한 앱 안에서** 로그인해야 한다.

## 데이터

`public/data/kanji.json`(목록·음훈·훈음)과 `public/data/strokes.json`(획순)은 미리 생성해 저장소에 포함했다. 다시 만들려면:

```sh
./scripts/fetch-sources.sh
npm run build-data   # 한국 음 대조 결과와 문제 항목을 출력
```

- 상용한자 목록, 공식 음훈, 旧字体: ja.wikipedia 「常用漢字一覧」 (CC BY-SA). 괄호로 표시된 읽기는 특수 읽기(`sp`)로 분리
- 획순: [KanjiVG](https://kanjivg.tagaini.net) (CC BY-SA 3.0)
- 빈도, 영어 뜻, 한국 음(검증용): [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (CC BY-SA 4.0)
- 한국어 훈음: `scripts/korean/*.tsv`. 직접 작성한 뒤 빌드 스크립트가 KANJIDIC 한국 음과 자동 대조함. 훈(뜻) 부분은 자동 검증이 되지 않으므로, 틀린 곳은 앱의 목록 화면에서 고치면 기기 간에 동기화됨
