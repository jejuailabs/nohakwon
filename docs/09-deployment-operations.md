# 09. 리포트·결제·개인정보·배포·운영

## 1. 시험

### 1.1 주간 미니시험 `[명세 10장]`

- 매주 7일차(체험) / 구독 후 매 7일 주기에 학습 범위 중심 종합 시험 출제
- 구성 `[제안]`: 과목당 5문항 × 5과목 = 25문항, 그 주에 학습한 개념 비율대로 배분, 취약 개념 가중
- 자동 채점 → 결과를 복습 대기열·오답노트에 반영 `[명세]`
- 데이터: `students/{sid}/assessments/{id}` `{ type: 'weekly'|'midterm'|'final', range, questionIds, score, bySubject }`

### 1.2 중간·기말 대비 (MVP 이후, 부가 상품 후보)

- 학부모/학생이 시험 범위(단원·기간) 지정 → 해당 범위에서 개념·난이도 비율을 조정한 모의시험 구성 `[명세]`
- 화면·안내문에 **"실제 시험 적중을 보장하지 않습니다"** 명시 `[명세]`

## 2. 학부모 리포트 `[명세 11장]`

### 2.1 발행 시점

| 리포트 | 시점 |
|---|---|
| 체험 종료 리포트 | 7일차 시험 완료 시 (미완료면 8일차 00:30 KST) |
| 주간 | 정규 구독 매 7일 |
| 월간 | MVP 이후 |

### 2.2 구성

| 섹션 | 항목 |
|---|---|
| 핵심 지표 | 일별 학습 참여, 총 풀이 수, 과목별 정답률, 평균 풀이시간, 자기평가 분포 |
| 학습 변화 | 첫 풀이 대비 재복습 정답률, 취약 개념 개선 여부, 난이도 이동, 미완료 복습 |
| 진도 현황 | 교과서 단원별 진행 상태, 현재 학습 위치, 다음 주 추천 단원 |
| 실행 권고 | 우선 복습할 개념 3개, 권장 학습량, 주간 실천 제안 |
| 솔직함·극복 | 솔직하게 "모른다"고 표시한 횟수, 그중 복습으로 극복한 개념 수 |

### 2.3 생성 방식

1. 수치는 Functions에서 **코드로 집계** (AI 사용 안 함)
2. 해석 문장은 템플릿(4개 국어) 기반, 필요 시 AI `analyze`로 짧은 해석 보강 — **익명화된 집계 수치만 전송**
3. 결과를 `students/{sid}/reports/{id}`에 저장, 보호자에게 앱 내 알림 (이메일 발송은 ⚠️ 발송 서비스 미정)

### 2.4 표기 규칙 `[명세]`

- 표본이 적으면 **"경향 추정"** 표시 `[제안 기준: 개념별 풀이 5회 미만]`
- 초기 문제와 재복습 문제의 난이도가 다르면 단순 정답률 비교가 왜곡될 수 있음을 리포트에 명시
- 학생과 보호자에게 필요한 정보만 노출
- **"모르겠다·알쏭달쏭" 표시가 많은 것을 부정적으로 쓰지 않음.** 리포트 문구는 "솔직하게 표시하고 복습한 횟수"처럼 성실함의 신호로 표현하고, 보호자에게도 이 서비스가 솔직한 표시를 칭찬한다는 점을 안내 (보호자가 "왜 모르는 게 이렇게 많냐"고 꾸짖으면 학생이 다시 전부 "안다"를 고르게 됨)

## 3. 결제·구독 `[명세 15장]`

### 3.1 정책

- 7일 전 기능 체험 → **월 5,000원** 구독
- 핵심 가치(유료): 일일 학습, 간격 복습, 오답노트, 기본 리포트
- 체험 만료 후 미결제: 새 문제 배정 중단, 기존 데이터 열람·보관 정책은 **사전 고지** `[명세]`
- 과금 단위: ⚠️ 보호자당 1구독인지, 자녀당 5,000원인지 확정 필요 (현재 가정: **자녀 1명당 월 5,000원**)

### 3.2 PG 연동 ⚠️ 미정

| 후보 | 비고 |
|---|---|
| 토스페이먼츠 | 자동결제(빌링키) API 제공 |
| 포트원(PortOne) | 여러 PG 통합 연동 |

공식 문서에서 정기결제 조건·수수료·심사 요건을 확인 후 결정합니다. 앱 코드는 PG 독립 인터페이스로 작성합니다.

```ts
interface BillingProvider {
  createCheckout(guardianUid: string, studentIds: string[]): Promise<{ url: string }>
  handleWebhook(req: Request): Promise<BillingEvent>   // 서명 검증 필수
  cancel(subscriptionId: string): Promise<void>
}
```

### 3.3 상태 전이

```
trial ─(결제 성공)─▶ active ─(갱신 실패)─▶ past_due ─(유예 3일 [제안] 경과)─▶ expired
  │                    │                                                       ▲
  └─(7일 경과·미결제)──┴──────────(해지 후 기간 종료)──────────────────────────┘
```

`students.access`는 서버(웹훅·스케줄러)만 변경합니다.

## 4. 개인정보·보안 `[명세 16장]`

| 항목 | 조치 |
|---|---|
| 최소 수집 | 학생: 닉네임·학년·교과서·학습 기록. 실명·생년월일·연락처는 수집하지 않음 `[제안]` |
| 보호자 동의 | 만 14세 미만 법정대리인 동의 절차 (문서 04 §2) ⚠️ 법률 검토 |
| 계정·데이터 삭제 | 보호자가 앱에서 요청 → 서버 재귀 삭제 → 완료 안내 |
| 권한 통제 | 보안 규칙 + 서버 검증 + 관리자 역할 분리 + 감사 로그 |
| 학습 기록 암호화 | Firestore 저장 시 기본 암호화(Google 관리 키). 추가 필드 암호화 필요 여부 ⚠️ 검토 |
| 생성형 AI | 학생 식별정보 전송 금지, 프롬프트 로그에도 저장 금지 |
| 문항 저작권 | `origin`, `sourceNote` 필드로 출처 관리 |
| 매핑 버전 | 교육과정·판본 변경 시 `mappingVersion` 관리 |
| 비밀값 | Vercel 환경변수(서버 전용), Functions Secret Manager. 클라이언트 번들에 비밀값 금지 |
| 남용 방지 | Firebase App Check 적용 검토, `/api/attempts` 속도 제한 |

필수 문서: 이용약관, 개인정보처리방침, 아동 개인정보 처리 안내, 환불 정책 — ⚠️ 법률 검토 후 4개 국어 게시 (법적 효력 기준 언어는 한국어로 명시 권장)

## 5. 환경 구성

### 5.1 Firebase 프로젝트

| 프로젝트 | 용도 |
|---|---|
| `app-dev` | 개발·프리뷰 |
| `app-prod` | 프로덕션 |

- Blaze 요금제 (Functions·Scheduler 필요)
- Firestore 리전: `asia-northeast3`(서울) 권장 — 생성 후 변경 불가이므로 신중히 선택
- Functions 리전 동일하게 지정

### 5.2 Vercel

- Root Directory: `apps/web`
- Preview → `app-dev`, Production → `app-prod` 환경변수 분리
- Vercel Functions 리전을 서울(`icn1`)로 지정해 Firestore와 지연 최소화 `[제안]`
- 프리뷰 도메인을 Firebase Auth 승인된 도메인에 추가 (와일드카드 미지원 시 고정 프리뷰 도메인 사용) ⚠️ 확인 필요

### 5.3 환경변수

| 변수 | 위치 | 공개 |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Vercel | 공개 가능(클라이언트 설정값) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Vercel | 공개 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Vercel | 공개 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Vercel | 공개 |
| `FIREBASE_ADMIN_PROJECT_ID` | Vercel | 서버 전용 |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Vercel | 서버 전용 |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Vercel | **비밀** (줄바꿈 `\n` 처리 주의) |
| `SESSION_COOKIE_DAYS` | Vercel | 서버 |
| `ADMIN_EMAIL_DOMAIN_ALLOWLIST` | Vercel/Functions | 서버 (선택) |
| `BILLING_PROVIDER`, `BILLING_SECRET_KEY`, `BILLING_WEBHOOK_SECRET` | Vercel | **비밀** |
| `ANTHROPIC_API_KEY` | Functions Secret | **비밀** |

## 6. CI/CD

```
PR → GitHub Actions
  ├─ pnpm lint, typecheck
  ├─ packages/core 단위 테스트
  ├─ i18n 키 일치 검사
  ├─ Firestore 규칙 테스트 (에뮬레이터)
  └─ Vercel Preview 배포 (자동)
main 병합 → Vercel Production + firebase deploy --only functions,firestore:rules,firestore:indexes
```

## 7. 모니터링

- Vercel 로그·Analytics, Firebase Functions 로그, Cloud Monitoring 알림 (함수 오류율, 스케줄 실패)
- 일일 배정 생성 실패 학생 수를 `statsDaily`에 기록, 0이 아니면 알림
- AI 비용 일 한도 초과 시 `aiJobs` 자동 중지 `[제안]`
- 오류 추적 도구(예: Sentry) 도입 검토

## 8. 출시 전 체크리스트 `[명세 16장 + 추가]`

- [ ] 교과서별 목차 확보 범위 (1학년 5과목 주요 출판사)
- [ ] 문항 검증 정확도 (검수 승인율, 오류율 목표 설정)
- [ ] 주관식(단답형) 채점 기준
- [ ] 공식 AI 모델명·단가 확인 및 100문항 실측
- [ ] 개인정보·결제 관련 법률 검토, 약관·방침 게시
- [ ] 만 14세 미만 학생 계정 방식 확정 (문서 04)
- [ ] PG 계약·정기결제 심사
- [ ] 4개 국어 번역 검수
- [ ] 라이트/다크 모드 전 화면 대비 검사
- [ ] Firestore 보안 규칙 테스트 통과
- [ ] 백업: Firestore 예약 내보내기(Scheduled export) 설정
