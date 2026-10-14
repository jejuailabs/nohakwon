# 중학생 AI 맞춤형 일일학습 플랫폼

> 교과서별 진도에 맞춰 매일 핵심 문제를 풀고, 정답·자기평가·복습 결과를 누적해 부족한 개념을 반복 보완하는 저비용 구독형 학습 서비스

- 기준 문서: `중학생_AI_맞춤학습_구현명세서.pdf` (2026.10.14)
- 문서 상태: **초안 v0.1** — 각 문서의 `⚠️ 확인 필요` 항목은 구현 전 확정해야 합니다.

## 실행 가능한 학습 체험 버전 — B 디자인 확정 (2026.10.14)

현재 `apps/web`에 Next.js + TypeScript 앱, `packages/core`에 공통 학습 로직이 구현되어 있습니다.
Google 로그인·서버 세션·보호자 학생 프로필의 Firestore 저장을 구현했습니다. 아래 기존 설계 문서는 최종 제품의 목표이며, 서버 채점·학습 기록 동기화·결제 등은 후속 범위입니다.

```bash
npm install
npm run dev
```

- 기본 화면 · 캐릭터 퀘스트: <http://127.0.0.1:3000> (B로 이동)
- B 직접 주소: <http://127.0.0.1:3000/b>
- 보호자 로그인: <http://127.0.0.1:3000/login>, 학생 프로필: `/onboarding`. 환경 설정은 [docs/12-firebase-accounts.md](docs/12-firebase-accounts.md)를 참고하세요. Node.js 22 이상을 사용합니다.
- 사용자가 B를 최종 디자인 방향으로 선택했습니다. 기본 화면에서 A/B 선택기를 제거했으며, 이후 화면은 캐릭터 퀘스트 디자인을 기준으로 개발합니다.
- A · 학습 마을은 이전 시안 확인용으로 `/a`에 보존합니다. 동일 호스트의 두 주소는 진도·포인트·오답·북마크를 공유합니다.
- 5과목 × 10문항, 답안 선택 → 자기평가 → 채점/해설, 복습 일정, 오답 재풀이, 북마크, 학습 기록, 프로필/저자극 모드를 체험할 수 있습니다.
- 문항은 데모용 고정 샘플입니다. 매일 새 문항을 공급하는 실제 문제은행은 아닙니다. 정답도 브라우저에 포함되어 있습니다.
- 프로필은 Firestore에 저장하며, 풀이 기록은 현재 브라우저의 `localStorage`에 계정별로 구분해 저장합니다. 체험 기록과 로그인 기록은 자동으로 합치지 않습니다. 서버 채점과 풀이 기록 동기화는 이후 구현 범위입니다.
- 최초 실행 기준 기록은 비어 있으며, 통계·레벨·포인트는 실제 체험 결과에 따라 변합니다.
- 현재 체크아웃은 npm workspaces와 `package-lock.json`을 사용합니다. 아래 pnpm/Firebase 명령은 향후 제품 구성에 관한 설계입니다.

검증: `npm test` (학습 로직), `npm run typecheck`, `npm run build`.
Windows에서 제한된 실행 환경의 `tsx`가 `uv_os_get_passwd` 오류를 내면 일반 터미널에서 `npm test`를 실행하세요.

구현 범위와 후속 연결 사항은 [docs/11-design-preview.md](docs/11-design-preview.md)를 참고하세요.

---

## 1. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 대상 | 중학교 1~3학년 (1차 MVP: 1학년) |
| 과목 | 국어·영어·수학·사회·과학 (5과목) |
| 일일 학습량 | 신규 10문제 × 5과목 = 50문제, 복습 포함 최대 100문제 |
| 핵심 기능 | 교과서 진도 엔진, 문제은행, 3단계 자기평가 + 솔직함 보상(칭찬·포인트), 간격 반복 복습, 난이도 자동 조절, 오답노트, 주간 시험, 학부모 리포트 |
| 수익 모델 | 7일 전 기능 무료 체험 → 월 5,000원 구독 |
| UI 언어 | 한국어(기본) · English · 中文(简体) · 日本語 |
| 테마 | 라이트 / 다크 / 시스템 설정 토글 |
| 로그인 | Google 로그인 전용 (학생·학부모·관리자 공통) |
| 관리자 | Google 로그인 + 권한(Custom Claims) 기반 어드민 대시보드 |
| 디자인 | **B · 캐릭터 퀘스트 확정**. 남색·보라 기반 게임형 UI (`designs/mockup-v1.png`, 문서 10·11) |

## 2. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프런트엔드 | Next.js (App Router) + TypeScript | Vercel 배포 |
| 스타일 | Tailwind CSS + CSS 변수 디자인 토큰 | 디자인 수령 후 토큰 값 확정 |
| 다국어 | next-intl | `/[locale]/...` 라우팅 |
| 테마 | next-themes | `class` 전략, FOUC 방지 |
| 인증 | Firebase Authentication (Google Provider) | 관리자 권한은 Custom Claims |
| DB | Cloud Firestore | 명세서의 관계형 테이블을 컬렉션 구조로 변환 |
| 서버 로직 | Next.js Route Handlers (Vercel) + Cloud Functions for Firebase | 스케줄러·AI 호출은 Functions |
| 파일 | Cloud Storage for Firebase | 리포트 PDF 등 (선택) |
| AI | Claude API (Anthropic) | Functions에서만 호출, 키는 Secret Manager |
| 결제 | ⚠️ PG사 미정 (토스페이먼츠 / 포트원 등 후보) | 인터페이스만 우선 정의 |

> ⚠️ Cloud Functions와 Cloud Scheduler 사용에는 Firebase **Blaze(종량제) 요금제**가 필요합니다. ([Firebase 요금제 안내](https://firebase.google.com/pricing))

## 3. 저장소 구조 (pnpm workspace)

```
/
├─ README.md
├─ docs/                     # 설계 문서 (아래 목록 참고)
├─ designs/                  # 디자인 시안·에셋 (mockup-v1.png)
├─ apps/
│  └─ web/                   # Next.js 앱 (Vercel Root Directory)
│     ├─ src/app/[locale]/   # 학생·학부모·어드민 화면
│     ├─ src/app/api/        # Route Handlers (결제 웹훅 등)
│     ├─ src/components/
│     ├─ src/lib/firebase/   # client.ts / admin.ts
│     ├─ src/i18n/           # next-intl 설정
│     └─ messages/           # ko.json en.json zh.json ja.json
├─ functions/                # Cloud Functions (스케줄러, AI, 리포트)
├─ packages/
│  └─ core/                  # 순수 TS 로직: 간격반복·난이도·배정 알고리즘
├─ firestore.rules
├─ firestore.indexes.json
├─ storage.rules
└─ firebase.json
```

학습 엔진(간격 반복, 난이도 조절, 문항 배정)은 `packages/core`에 **외부 의존성 없는 순수 함수**로 두어 웹·Functions가 함께 쓰고 단위 테스트를 쉽게 합니다.

## 4. 빠른 시작

```bash
# 1) 의존성
pnpm install

# 2) 환경변수
cp apps/web/.env.example apps/web/.env.local

# 3) Firebase 에뮬레이터 (Auth, Firestore, Functions)
pnpm firebase emulators:start

# 4) 웹 개발 서버
pnpm --filter web dev
```

환경변수 전체 목록은 [docs/09-deployment-operations.md](docs/09-deployment-operations.md)를 참고하세요.

## 5. 문서 목록

| # | 문서 | 내용 |
|---|---|---|
| 01 | [product-overview](docs/01-product-overview.md) | 제품 목표, 사용자, 기능 범위, MVP, 용어집 |
| 02 | [architecture](docs/02-architecture.md) | 시스템 구성, Vercel/Firebase 역할 분담, 라우팅, 요청 흐름 |
| 03 | [data-model](docs/03-data-model.md) | Firestore 컬렉션 스키마, 인덱스, 명세서 테이블 매핑 |
| 04 | [auth-and-roles](docs/04-auth-and-roles.md) | Google 로그인, 보호자-학생 연결, 관리자 권한, 보안 규칙 |
| 05 | [learning-engine](docs/05-learning-engine.md) | 진도 엔진, 일일 배정, 자기평가·간격 반복, 난이도 조절, 7일 체험 |
| 06 | [question-bank-and-ai](docs/06-question-bank-and-ai.md) | 문제은행, 태그, 검증 파이프라인, 시각자료, AI 호출·비용 |
| 07 | [i18n-and-theming](docs/07-i18n-and-theming.md) | 4개 국어, 다크/라이트 토글, 디자인 토큰, 접근성 |
| 08 | [admin-dashboard](docs/08-admin-dashboard.md) | 어드민 메뉴, 화면별 기능, KPI |
| 09 | [deployment-operations](docs/09-deployment-operations.md) | 리포트·결제·개인정보·배포·테스트·출시 체크리스트 |
| 10 | [design-system](docs/10-design-system.md) | 시안 v1 해석, 화면 구성, 디자인 토큰, 컴포넌트, 게임 요소 매핑 |

## 6. 개발 원칙

1. **AI는 제한적으로.** 문제 배정·채점(객관식/단답형)·복습 일정·난이도 조절은 일반 코드로 처리합니다. AI는 문항 생성·변형·해설 개선·장기 분석에만 씁니다.
2. **문제은행 우선.** 출제는 DB 조회가 기본이며, AI 생성은 비동기로 은행을 채웁니다. 학생 요청 경로에서 AI를 동기 호출하지 않습니다.
3. **학생 데이터 최소화.** 생성형 AI에 개인정보를 보내지 않습니다.
4. **설정값은 코드에 박지 않습니다.** 복습 간격·난이도 임계값 등은 `appConfig` 문서에서 관리하고 어드민에서 수정합니다.
5. **확정되지 않은 수치는 확정처럼 쓰지 않습니다.** 비용·단가는 실측 후 기입합니다.

## 7. 구현 전 확정해야 할 사항 (요약)

| 항목 | 상태 | 관련 문서 |
|---|---|---|
| 만 14세 미만 학생의 Google 계정 사용 방식 | ⚠️ 확인 필요 | 04 |
| 문항 본문 언어 (UI만 4개 국어인지, 문항도 번역하는지) | ⚠️ 확인 필요 (현재 가정: 문항은 한국어) | 07 |
| 중국어 표기 (간체/번체) | ⚠️ 확인 필요 (현재 가정: 간체 `zh`) | 07 |
| 결제 PG사 및 정기결제 방식 | ⚠️ 미정 | 09 |
| AI 모델명·공식 단가·환율 | ⚠️ 실측 필요 | 06 |
| 교과서 목차 확보 범위·저작권 | ⚠️ 확인 필요 | 06 |
| 개인정보·결제 관련 법률 검토 | ⚠️ 필수 | 09 |
| 간격 반복 세부 수치 (명세서에 없는 값) | 제안값 — 운영 조정 | 05 |
| 솔직함 보상 포인트 수치·포인트 사용처 | 제안값 / ⚠️ 사용처 확정 필요 | 05 |
| 서비스명·탭 라벨·색상 원본값, 라이트 시안, 룰렛 처리 | ⚠️ 디자인 원본 필요 | 10 |
