# 02. 시스템 아키텍처

## 1. 구성도

```
┌──────────────────────────── Vercel ────────────────────────────┐
│  Next.js (App Router)                                          │
│  ├─ /[locale]/(student)   학생 화면                            │
│  ├─ /[locale]/(guardian)  학부모 화면                          │
│  ├─ /[locale]/admin       어드민 대시보드                      │
│  └─ /api/*                Route Handlers (Firebase Admin SDK)  │
│        · 답안 제출/채점   · 결제 웹훅   · 세션 쿠키 발급       │
└───────────────┬────────────────────────────────────────────────┘
                │ Firebase Client SDK / Admin SDK
┌───────────────▼────────────── Firebase ────────────────────────┐
│ Authentication (Google)   Firestore    Cloud Storage           │
│ Cloud Functions (2nd gen)                                      │
│  ├─ onSchedule: 일일 배정 생성, 리포트 생성, 체험 만료 처리    │
│  ├─ onDocumentWritten: 숙련도 집계, 문항 통계 갱신             │
│  ├─ onCall/Task Queue: AI 문항 생성·검증·요약                  │
│  └─ setAdminClaims (관리자만 호출)                             │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS (서버 측에서만)
          ┌─────▼─────┐
          │ Claude API │  문항 생성·변형·해설 개선·장기 분석
          └───────────┘
```

## 2. 역할 분담 원칙

| 처리 | 위치 | 이유 |
|---|---|---|
| 화면 렌더링, i18n, 테마 | Next.js (Vercel) | |
| 답안 제출·채점·복습 일정 계산 | Next.js Route Handler (Admin SDK) | 정답이 클라이언트에 노출되지 않도록 서버 채점 |
| 일일 배정 생성 | Cloud Functions `onSchedule` (매일 00:10 KST) + 첫 접속 시 지연 생성 fallback | |
| AI 호출 | Cloud Functions 전용 | API 키를 Secret Manager에만 저장, 재시도·비용 로그 일원화 |
| 집계 (정답률, 숙련도, 문항 통계) | Firestore 트리거 Functions | |
| 결제 웹훅 | Next.js Route Handler | PG 서명 검증 후 Firestore 갱신 |

> **정답 보호:** `questions` 문서의 정답·해설은 클라이언트에서 직접 읽지 못하게 분리 저장합니다 (`questions/{id}/private/answer`). 상세는 문서 03, 04.

## 3. 라우팅 구조 (apps/web/src/app)

```
[locale]/
├─ page.tsx                     # 랜딩
├─ login/page.tsx               # Google 로그인
├─ onboarding/                  # 보호자 동의, 자녀 프로필, 교과서·진도 설정
├─ (student)/
│  ├─ today/page.tsx            # 오늘의 학습
│  ├─ solve/[assignmentId]/     # 문제 풀이
│  ├─ notes/page.tsx            # 오답노트
│  ├─ reviews/page.tsx          # 예정 복습
│  ├─ exams/[assessmentId]/     # 주간 미니시험
│  └─ me/page.tsx               # 설정 (언어, 테마, 글자 크기, 캐릭터)
├─ (guardian)/
│  ├─ children/page.tsx
│  ├─ children/[studentId]/settings/
│  ├─ reports/[reportId]/
│  └─ billing/page.tsx
└─ admin/
   ├─ layout.tsx                # admin claim 검사
   └─ ... (문서 08)
api/
├─ attempts/route.ts            # 답안 제출·채점
├─ session/route.ts             # ID 토큰 → 세션 쿠키
├─ billing/webhook/route.ts
└─ admin/*                      # 서버 측 어드민 작업
```

## 4. 인증 흐름 (요약)

1. 클라이언트 `signInWithPopup(GoogleAuthProvider)` (모바일 Safari 등에서 팝업 문제 시 `signInWithRedirect`)
2. ID 토큰을 `/api/session`으로 보내 **HttpOnly 세션 쿠키** 발급 (Admin SDK `createSessionCookie`)
3. `middleware.ts`에서 locale 처리 + 보호 경로의 쿠키 존재 확인
4. 서버 컴포넌트·Route Handler에서 `verifySessionCookie`로 사용자·claims 확인

상세: [04-auth-and-roles](04-auth-and-roles.md)

## 5. 주요 요청 흐름

### 5.1 답안 제출

```
Client → POST /api/attempts {assignmentItemId, answer, selfEval, elapsedMs}
  1. 세션 검증, 해당 학생 소유 확인
  2. 정답 조회(private) → 채점
  3. packages/core: nextReview() 로 복습 일정 계산
  4. Firestore batch:
     - students/{sid}/attempts 추가
     - reviewQueue upsert
     - dailyAssignments 진행 상태 갱신
     - packages/core: rewardFor() → pointLedger 추가 + points 잔액 증가 (같은 트랜잭션)
  5. 응답: {correct, explanation, nextReviewAt, reward: {amount, messageKey}}
Trigger (Functions) → conceptMastery 갱신, 문항 통계 갱신, 난이도 조절 판단
```

### 5.2 일일 배정

```
onSchedule 00:10 KST → 활성 학생(체험 중 or 구독 중) 순회
  → packages/core: buildDailyAssignment(profile, mastery, reviewQueue, bankIndex)
  → students/{sid}/dailyAssignments/{YYYY-MM-DD} 저장
  → 은행 부족 개념은 aiJobs 에 생성 요청 적재 (비동기)
```

학생 수가 늘면 학생별 작업을 Cloud Tasks 큐로 분산합니다.

## 6. 시간대

모든 "하루" 기준은 **Asia/Seoul**. Firestore에는 UTC Timestamp로 저장하고, 날짜 키(`YYYY-MM-DD`)는 KST로 계산합니다. 해외 거주 사용자 대응은 MVP 범위 밖입니다. ⚠️ 확인 필요

## 7. 성능·비용 고려

- Firestore는 **읽기 횟수 과금**이므로 화면당 읽기 수를 설계 단계에서 제한 (오늘의 학습 화면: 배정 문서 1개 + 문항 묶음 조회)
- 일일 배정 문서에 문항 표시용 필드(본문·선지·시각자료 데이터)를 **비정규화 스냅샷**으로 넣어 풀이 중 추가 읽기를 줄임 (정답 제외)
- 통계·리포트는 배치 집계 문서로 저장하고 대시보드는 집계 문서만 읽음
