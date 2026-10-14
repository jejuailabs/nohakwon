# 07. 다국어와 테마

## 1. 다국어 (i18n)

### 1.1 지원 언어

| 코드 | 언어 | 비고 |
|---|---|---|
| `ko` | 한국어 | **기본(default) 및 fallback** |
| `en` | English | |
| `zh` | 中文(简体) | ⚠️ 간체 가정. 번체(`zh-TW`) 필요 여부 확인 필요 |
| `ja` | 日本語 | |

### 1.2 번역 범위 ⚠️ 확정 필요

| 대상 | 기본안 |
|---|---|
| UI 문구 (메뉴, 버튼, 안내, 오류, 이메일) | 4개 국어 모두 |
| 자기평가 라벨, 배지, 리포트 템플릿 문구 | 4개 국어 모두 |
| 교과서 단원명 | 한국어 원문 표시 (교과서 표기 유지) |
| **문항 본문·해설** | **한국어만** (한국 교육과정 콘텐츠). 다국어 해설은 추후 검토 |
| 어드민 | 같은 시스템 사용, 번역 우선순위는 ko → en |

> 문항까지 번역하면 AI 비용·검수 부담이 언어 수만큼 늘어나므로, MVP는 UI만 번역하는 안을 권장합니다. 다문화 가정 학부모를 위한 **리포트 해석 문장 번역**은 우선 검토 대상입니다.

### 1.3 구현 (next-intl)

```
apps/web/
├─ messages/ko.json  en.json  zh.json  ja.json
├─ src/i18n/routing.ts     # locales, defaultLocale: 'ko', localePrefix: 'always'
├─ src/i18n/request.ts     # getRequestConfig → messages 로드
└─ src/middleware.ts       # next-intl 미들웨어 + 인증 쿠키 검사 결합
```

- URL: `/ko/today`, `/en/today` … 루트 `/` 접속 시 `Accept-Language` → 저장된 사용자 설정 순으로 리다이렉트
- 사용자가 언어를 바꾸면 `users/{uid}.locale` 저장 + `NEXT_LOCALE` 쿠키 갱신
- 메시지 키 규칙: `영역.화면.요소` (예: `student.today.startButton`)
- 날짜·숫자: `useFormatter()` / `Intl` 사용, 하드코딩 금지
- 누락 키 검사: CI에서 4개 파일의 키 집합이 동일한지 스크립트로 검사 (`pnpm i18n:check`)
- 번역 작업: 기준 언어 `ko.json` 작성 → 번역 → 원어민 검수. AI 초벌 번역 시 검수 표시

```json
// messages/ko.json (예)
{
  "common": { "login": "Google로 로그인", "logout": "로그아웃" },
  "selfEval": { "known": "완전히 알았다", "unsure": "알쏭달쏭하다", "unknown": "전혀 모르겠다" },
  "student": { "today": { "title": "오늘의 학습", "progress": "{done} / {total} 문제" } }
}
```

### 1.4 폰트

- 한·중·일 글리프를 모두 지원하는 폰트 스택 필요 (예: Pretendard + Noto Sans SC/JP fallback)
- 언어별로 `<html lang>` 설정, CJK 폰트는 `next/font`로 필요한 언어만 로드
- ⚠️ 최종 폰트는 별도 제공될 디자인에서 확정

## 2. 다크 / 라이트 모드

### 2.1 요구사항

- 토글 스위치로 **라이트 / 다크 / 시스템** 선택 (헤더 및 설정 화면)
- 첫 화면 깜빡임(FOUC) 없음
- 로그인 사용자는 기기 간 설정 동기화

### 2.2 구현 (next-themes)

```tsx
// app/[locale]/layout.tsx
<html lang={locale} suppressHydrationWarning>
  <body>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  </body>
</html>
```

- `attribute="class"` → `<html class="dark">`, Tailwind `darkMode: 'class'`
- 토글 컴포넌트는 마운트 후 렌더링 (하이드레이션 불일치 방지)
- 변경 시 `users/{uid}.theme` 저장, 로그인 직후 서버 값으로 동기화

### 2.3 디자인 토큰 (자리만 정의, 값은 디자인 수령 후 확정)

```css
/* apps/web/src/styles/tokens.css */
:root {
  --color-bg: ;            --color-surface: ;      --color-text: ;
  --color-text-muted: ;    --color-primary: ;      --color-primary-contrast: ;
  --color-border: ;        --color-correct: ;      --color-wrong: ;
  --color-unsure: ;        --color-focus-ring: ;
  --radius-card: ;         --font-sans: ;          --font-scale: 1;
}
.dark { /* 같은 변수의 다크 값 */ }
[data-low-stimulus="true"] { /* 채도·애니메이션 축소 값 */ }
```

- Tailwind는 위 변수를 참조 (`bg-[var(--color-bg)]` 또는 theme.extend.colors 매핑)
- **정답/오답 표시는 색만으로 구분하지 않음** (아이콘·텍스트 병행)
- SVG 시각자료도 같은 변수를 사용해 다크 모드에서 대비 유지

## 3. 화면·동기부여 요소 `[명세 12장]`

| 항목 | 구현 |
|---|---|
| 테마·캐릭터·배경색·배지 선택 | `students.ui` 저장, 장식은 문제 영역 밖 주변 UI에만 |
| 문제 영역 | 가독성 우선 (장식 없음, 충분한 행간) |
| 반응형 | 모바일·태블릿·PC (breakpoint는 디자인 기준) |
| 글자 크기 조절 | `--font-scale` 0.9 / 1 / 1.15 / 1.3 |
| 저자극 모드 | `data-low-stimulus`, `prefers-reduced-motion` 존중 |
| 진도율·연속 학습일 | 헤더 또는 대시보드 위젯 |
| 포인트 잔액 | 헤더에 항상 표시, 탭하면 적립 내역 |

### 3.1 솔직함 칭찬 피드백 (문서 05 §3.6)

- 자기평가 버튼을 누르는 **즉시** (정답 공개 전) 칭찬 메시지와 `+N` 포인트 애니메이션 표시
- "알쏭달쏭·모르겠다" 버튼을 "알았다"보다 덜 눈에 띄게 만들지 않음 — 세 버튼은 같은 크기·같은 시각적 무게
- 버튼 아래 보조 문구로 "솔직하게 고르면 포인트!"처럼 정직 선택을 장려
- 메시지는 여러 문구를 무작위로 돌려 반복 피로를 줄임
- 저자극 모드에서는 애니메이션 없이 텍스트만 표시
- "알았다 + 오답"에는 실망 표현(빨간 X 강조, 경고음) 없이 격려 문구만

```json
// messages/ko.json (예)
"reward": {
  "unknown": ["솔직하게 말해줘서 멋져요!", "모르는 걸 아는 게 진짜 공부의 시작이에요"],
  "unsure": ["헷갈리는 걸 알아챈 것도 실력이에요", "좋아요, 확실하게 만들어 봐요"],
  "knownCorrect": ["정확해요!"],
  "knownWrong": ["괜찮아요, 지금 발견해서 다행이에요. 곧 다시 만나요"],
  "conquer": ["어제 모르던 걸 해냈어요!"],
  "points": "+{amount} 포인트"
}
```

## 4. 접근성 체크리스트

- 명도 대비 WCAG 2.1 AA (라이트·다크 모두)
- 키보드만으로 문제 풀이·제출·자기평가 가능
- 토글 스위치 `role="switch"`, `aria-checked`, 라벨 번역
- 터치 영역 최소 44×44px
- 수식(KaTeX)에 접근 가능한 텍스트 제공
