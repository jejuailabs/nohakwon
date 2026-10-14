# 03. 데이터 모델 (Cloud Firestore)

명세서 13장의 관계형 테이블을 Firestore 컬렉션으로 변환합니다. 학생별 대용량 데이터(풀이 이력, 복습 대기열 등)는 **학생 문서의 하위 컬렉션**에 두어 보안 규칙과 조회를 단순화합니다.

> ⚠️ 설계 판단: 명세서는 관계형 테이블 구조이며, Firestore는 조인·집계가 약합니다. 리포트·운영 분석이 복잡해지면 **Firestore → BigQuery 내보내기 확장**을 추가하는 것을 권장합니다. ([Stream Firestore to BigQuery](https://extensions.dev/extensions/firebase/firestore-bigquery-export))

## 1. 명세서 테이블 → 컬렉션 매핑

| 명세서 테이블 | Firestore 경로 |
|---|---|
| users | `users/{uid}` |
| guardians | `users/{uid}` (role=guardian) + `guardianLinks` |
| student_profiles | `students/{studentId}` |
| textbooks | `textbooks/{textbookId}` |
| textbook_units | `textbooks/{textbookId}/units/{unitId}` |
| curriculum_standards | `curriculumStandards/{code}` + `concepts/{conceptId}` |
| questions | `questions/{questionId}` + `questions/{id}/private/answer` |
| question_tags | `questions` 문서 필드 (배열/맵) |
| question_variants | `variantGroups/{groupId}` + 문항의 `variantGroupId` |
| attempts | `students/{sid}/attempts/{attemptId}` |
| concept_mastery | `students/{sid}/conceptMastery/{conceptId}` |
| review_queue | `students/{sid}/reviewQueue/{conceptId}` |
| daily_assignments | `students/{sid}/dailyAssignments/{YYYY-MM-DD}` |
| assessments | `students/{sid}/assessments/{assessmentId}` |
| reports | `students/{sid}/reports/{reportId}` |
| subscriptions | `subscriptions/{guardianUid}` |
| ai_usage_logs | `aiUsageLogs/{logId}` |
| (추가) | `students/{sid}/pointLedger`, `appConfig/main`, `questionDisputes`, `aiJobs`, `adminAuditLogs`, `statsDaily` |

## 2. 컬렉션 스키마

표기: `?` = 선택, `T` = Timestamp, `L` = 다국어 맵 `{ko, en, zh, ja}`

### 2.1 users/{uid}

```ts
{
  uid: string
  email: string
  displayName: string
  role: 'guardian' | 'student'      // 관리자 여부는 Custom Claims 로만 판단
  locale: 'ko' | 'en' | 'zh' | 'ja'
  theme: 'light' | 'dark' | 'system'
  studentId?: string                // role=student 이고 본인 계정이 연결된 경우
  createdAt: T
  lastLoginAt: T
}
```

### 2.2 students/{studentId}

```ts
{
  guardianUid: string
  linkedUid?: string                // 학생 본인 Google 계정 (있을 때)
  nickname: string                  // 실명 대신 닉네임 권장
  grade: 1 | 2 | 3
  schoolName?: string               // 최소 수집, 선택
  subjects: {
    [subject in 'kor'|'eng'|'math'|'soc'|'sci']: {
      enabled: boolean
      textbookId: string
      currentUnitId: string
      dailyNew: number              // 기본 10
      baseDifficulty: 1|2|3|4|5
    }
  }
  autoDifficulty: boolean
  mode: 'trial' | 'regular'
  trial: { startedAt: T, endsAt: T, completedDays: number }
  access: 'active' | 'expired'      // 결제 상태 반영, 새 문제 배정 여부
  streak: { current: number, best: number, lastDate: string }
  points: { balance: number, lifetime: number, honestyCount: number, conquerCount: number }  // 서버만 기록 (문서 05 §3.6)
  examRange?: { name: string, unitIds: string[], examDate: T }
  ui: { character?: string, themeColor?: string, fontScale: number, lowStimulus: boolean }
  createdAt: T
}
```

### 2.3 textbooks/{textbookId} · units

```ts
// textbooks/{textbookId}   예: "g1-math-publisherA-2022rev"
{
  grade: 1|2|3, subject: string, publisher: string, edition: string,
  curriculumVersion: string,        // 예: "2022 개정"
  mappingVersion: number,           // 목차 매핑 버전 (판본 변경 대응)
  source: 'auto' | 'manual', status: 'draft' | 'verified' | 'archived'
}

// textbooks/{id}/units/{unitId}
{
  order: number, depth: 1 | 2,      // 대단원 / 소단원
  parentUnitId?: string,
  title: string,                    // 교과서 원문 표기(한국어)
  standardCodes: string[],
  conceptIds: string[]
}
```

### 2.4 curriculumStandards / concepts

```ts
// curriculumStandards/{code}
{ code: string, grade, subject, description: string, curriculumVersion: string }

// concepts/{conceptId}
{
  name: string, subject, grade,
  standardCodes: string[],
  prerequisiteIds: string[],        // 선수개념
  stats: { attempts: number, correctRate: number }
}
```

### 2.5 questions/{questionId}

```ts
{
  // 필수 태그
  grade, subject,
  textbookIds: string[],            // 출판사/판본 (공용 문항이면 여러 개)
  unitIds: string[],
  standardCodes: string[],
  conceptId: string,
  difficulty: 1|2|3|4|5,
  type: 'mcq' | 'short' | 'essay',
  status: 'draft' | 'auto_checked' | 'needs_review' | 'verified' | 'disabled',

  // 선택 태그
  prerequisiteIds?: string[],
  expectedSec?: number,
  visualType?: 'graph' | 'geometry' | 'coordinate' | 'experiment' | null,
  variantGroupId?: string,
  examScopes?: ('midterm' | 'final')[],

  // 표시 데이터 (정답 제외)
  stem: string,                     // 마크다운 + KaTeX
  choices?: string[],
  visual?: VisualSpec,              // 문서 06의 구조화 시각자료
  origin: 'ai' | 'manual' | 'licensed',
  sourceNote?: string,              // 저작권·출처

  stats: { served: number, correct: number, avgSec: number, disputes: number },
  calibratedDifficulty?: number,    // 실제 정답률 기반 보정값
  createdAt: T, verifiedAt?: T, verifiedBy?: string
}

// questions/{id}/private/answer   ← 클라이언트 읽기 금지
{ answer: string | string[], acceptable?: string[], explanation: string }
```

### 2.6 students/{sid}/attempts/{attemptId}

명세서 8장의 필수 저장 항목을 그대로 포함합니다.

```ts
{
  studentId, questionId, conceptId, subject, unitId,
  servedAt: T, submittedAt: T, elapsedSec: number,
  answer: string, correct: boolean,
  selfEval: 'known' | 'unsure' | 'unknown',
  difficulty: number,
  kind: 'new' | 'review' | 'exam' | 'diagnostic',
  reviewRound: number,              // 0 = 최초
  nextReviewAt?: T,
  errorCause?: { value: 'concept'|'calc'|'reading'|'other', by: 'student'|'ai' }
}
```

### 2.7 students/{sid}/conceptMastery/{conceptId}

```ts
{
  subject, conceptId,
  attempts: number, correct: number,
  recent: { correct: boolean, sec: number, selfEval: string, at: T }[], // 최근 10건
  currentDifficulty: 1|2|3|4|5,
  lastDifficultyChangeAt?: T,
  reviewSuccessStreak: number,
  weakness: number,                 // 0~1, 배정 우선순위용 (문서 05)
  misconceptionFlag: boolean        // "안다"고 했는데 오답
}
```

### 2.8 students/{sid}/reviewQueue/{conceptId}

개념 단위로 1건 유지(동형·변형 문항으로 복습하므로 문항 단위가 아님).

```ts
{
  conceptId, subject,
  dueDate: string,                  // 'YYYY-MM-DD' (KST)
  intervalDays: number,
  round: number,
  lastSelfEval, lastCorrect: boolean,
  sourceQuestionId: string,         // 같은 문항 재출제 회피용
  priority: number,                 // 배정 시점 계산
  carriedOver: number               // 이월 횟수
}
```

### 2.9 students/{sid}/dailyAssignments/{YYYY-MM-DD}

```ts
{
  date: string, mode: 'trial' | 'regular', trialDay?: 1..7,
  items: {
    itemId: string, questionId: string, subject, kind: 'new'|'review',
    snapshot: { stem, choices?, visual?, difficulty },   // 정답 제외
    status: 'pending' | 'done', attemptId?: string
  }[],
  counts: { new: number, review: number, total: number },   // total ≤ 100
  completedAt?: T
}
```

### 2.10 students/{sid}/pointLedger/{entryId}

포인트 적립·사용 내역. 잔액(`students.points.balance`)과 같은 트랜잭션으로 기록합니다.

```ts
{
  type: 'honesty_unknown' | 'honesty_unsure' | 'known_correct'
      | 'conquer' | 'mastered' | 'review_complete' | 'spend',
  amount: number,                   // 사용은 음수
  conceptId?: string, attemptId?: string, itemId?: string,   // 사용 시 해금 아이템
  date: string,                     // KST 'YYYY-MM-DD' (같은 개념 하루 1회 판정용)
  createdAt: T
}
```

### 2.11 기타

```ts
// subscriptions/{guardianUid}
{ status: 'trial'|'active'|'past_due'|'canceled'|'expired', plan: 'monthly_5000',
  provider: string, customerKey?: string, currentPeriodEnd?: T, studentIds: string[] }

// aiUsageLogs/{logId}
{ purpose: 'generate'|'variant'|'verify'|'explain'|'analyze'|'report',
  model: string, inputTokens: number, outputTokens: number,
  costUsd?: number, jobId?: string, ok: boolean, createdAt: T }   // 학생 식별정보 저장 금지

// appConfig/main   (어드민에서 수정)
{ dailyNewDefault: 10, dailyMax: 100,
  srs: {...}, trialSrs: {...}, difficulty: {...},     // 문서 05 참고
  rewards: { honestyUnknown: 3, honestyUnsure: 2, knownCorrect: 1, conquer: 5,
             mastered: 3, reviewComplete: 5, minSolveSec: 3 },
  pricing: { models: { [model]: { inUsdPerM: number, outUsdPerM: number } }, fxKrw: number } }

// questionDisputes/{id}
{ questionId, studentId, reason, message?, status: 'open'|'accepted'|'rejected', createdAt }

// aiJobs/{id}
{ type: 'generate'|'variant'|'verify', params: {...}, status: 'queued'|'running'|'done'|'failed',
  attempts: number, resultQuestionIds?: string[] }

// adminAuditLogs/{id}
{ actorUid, action, target, before?, after?, at: T }
```

## 3. 복합 인덱스 (firestore.indexes.json 초안)

| 컬렉션 | 필드 | 용도 |
|---|---|---|
| questions | conceptId ↑, status ↑, difficulty ↑ | 배정 시 후보 조회 |
| questions | subject ↑, grade ↑, status ↑, createdAt ↓ | 어드민 목록 |
| questions | status ↑, stats.disputes ↓ | 품질 검토 |
| reviewQueue (collection group) | dueDate ↑ | 일괄 복습 배정 |
| attempts | conceptId ↑, submittedAt ↓ | 개념별 최근 이력 |
| attempts | correct ↑, submittedAt ↓ | 오답노트 |

## 4. 데이터 보존·삭제

- 계정 삭제 시: `students/{sid}` 및 하위 컬렉션 재귀 삭제 (Functions `recursiveDelete`), `users/{uid}` 삭제, Auth 사용자 삭제
- 구독 만료 시: 데이터는 보관하되 새 배정 중단. 보관 기간은 ⚠️ 정책 확정 필요 (사전 고지 대상)
- 문항 원본(`questions`)과 학생 풀이 이력은 분리되어 있으므로 학생 삭제가 문제은행에 영향을 주지 않음
