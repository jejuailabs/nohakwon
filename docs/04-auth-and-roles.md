# 04. 인증과 권한

## 1. 원칙

- 로그인 수단은 **Google 로그인 하나**입니다 (학생·학부모·관리자 공통).
- 관리자 권한은 Firestore 필드가 아니라 **Firebase Custom Claims**로만 판정합니다.
- 보호자-학생 연결, 관리자 권한, 일반 사용자 권한을 서로 분리합니다.

## 2. ⚠️ 만 14세 미만 학생 계정 문제 (확정 필요)

중학교 1학년은 대부분 만 12~13세입니다.

- **Google 계정 연령:** Google은 국가별 최소 연령을 두며, 한국은 만 14세로 알려져 있습니다. 그보다 어린 자녀는 보호자가 Family Link로 관리하는 계정을 써야 합니다. 정확한 기준은 공식 문서로 재확인하세요. ([Google 계정 연령 요건](https://support.google.com/accounts/answer/1350409))
- **개인정보보호법:** 만 14세 미만 아동의 개인정보 처리에는 법정대리인 동의가 필요합니다 (개인정보 보호법 제22조의2). 구체 적용은 법률 검토가 필요합니다.

**권장 기본안 (이 문서는 이 안으로 작성됨):**

1. **보호자가 Google로 가입**하고 동의 절차를 거친 뒤 자녀 프로필(`students`)을 만듭니다.
2. 학생 접속 방법은 두 가지를 지원합니다.
   - **(A) 보호자 계정에서 자녀 프로필로 전환** — 자녀 프로필에 4자리 PIN 설정 가능. 학생 개인 Google 계정이 없어도 이용 가능.
   - **(B) 학생 본인 Google 계정 연결** — 보호자가 발급한 **초대 코드**로 학생 계정을 `students/{sid}.linkedUid`에 연결. (Family Link 계정 포함)
3. 학생 정보는 닉네임·학년·교과서 등 학습에 필요한 최소 항목만 수집합니다.

## 3. 역할 모델

| 역할 | 판정 방법 | 할 수 있는 일 |
|---|---|---|
| guardian | `users/{uid}.role == 'guardian'` | 자녀 생성·설정, 리포트, 결제, 자녀 데이터 열람·삭제 |
| student | `students/{sid}.linkedUid == uid` 또는 보호자 세션의 프로필 전환 | 본인 배정 문항 풀이, 오답노트·복습 열람, UI 설정 |
| admin 계열 | Custom Claims `admin: true`, `adminRole` | 어드민 대시보드 (아래) |

### 3.1 관리자 세부 역할 (Custom Claims `adminRole`)

| adminRole | 권한 |
|---|---|
| `owner` | 전체 + 관리자 지정/해제 |
| `admin` | 전체 운영 (설정·사용자·결제 조회), 관리자 지정 불가 |
| `editor` | 교과서 매핑, 문항 생성·수정, AI 생성 요청 |
| `reviewer` | 문항 검수(verified 처리), 이의제기 처리 |

학생 개인정보 열람은 `owner`, `admin`만 가능하며 모든 열람·수정은 `adminAuditLogs`에 기록합니다.

## 4. 관리자 지정 절차

1. 최초 owner: 배포 후 1회 로컬 스크립트로 지정
   ```bash
   pnpm --filter functions run set-owner -- --email owner@example.com
   ```
   (Admin SDK `setCustomUserClaims(uid, { admin: true, adminRole: 'owner' })`)
2. 이후: 어드민 > 관리자 관리 화면 → Callable Function `setAdminRole` (호출자가 owner인지 서버에서 검증)
3. Claims 변경 후 사용자는 **토큰 갱신**(재로그인 또는 `getIdToken(true)`)이 필요합니다.
4. 선택: `ADMIN_EMAIL_DOMAIN_ALLOWLIST` 환경변수로 특정 도메인 계정만 관리자 지정 허용

## 5. 로그인 구현

```ts
// apps/web/src/lib/firebase/auth.ts (개요)
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export async function signIn() {
  const cred = await signInWithPopup(auth, provider);   // 실패 시 redirect fallback
  const idToken = await cred.user.getIdToken();
  await fetch('/api/session', { method: 'POST', body: JSON.stringify({ idToken }) });
}
```

- `/api/session`: `verifyIdToken` → `createSessionCookie` (만료 예: 5일) → `HttpOnly; Secure; SameSite=Lax`
- 첫 로그인 시 `users/{uid}`가 없으면 온보딩으로 이동 (role 선택: 보호자 / 학생 초대코드 입력)
- `/admin/*` 레이아웃: 서버에서 `verifySessionCookie(cookie, true)` 후 `claims.admin !== true`면 404 처리 (존재 노출 방지)
- Firebase Console > Authentication > 승인된 도메인에 Vercel 프로덕션·프리뷰 도메인 등록 필요

## 6. Firestore 보안 규칙 (초안)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function isAdmin() { return signedIn() && request.auth.token.admin == true; }
    function adminRole(r) { return isAdmin() && request.auth.token.adminRole in r; }
    function student(sid) { return get(/databases/$(db)/documents/students/$(sid)).data; }
    function isGuardianOf(sid) { return signedIn() && student(sid).guardianUid == request.auth.uid; }
    function isStudentSelf(sid) { return signedIn() && student(sid).linkedUid == request.auth.uid; }

    match /users/{uid} {
      allow read: if signedIn() && (request.auth.uid == uid || adminRole(['owner','admin']));
      allow create, update: if signedIn() && request.auth.uid == uid
        && !('admin' in request.resource.data);           // 권한 필드 위조 방지
    }

    match /students/{sid} {
      allow read: if isGuardianOf(sid) || isStudentSelf(sid) || adminRole(['owner','admin']);
      allow create: if signedIn() && request.resource.data.guardianUid == request.auth.uid;
      allow update: if isGuardianOf(sid)
        && !request.resource.data.diff(resource.data).affectedKeys()
             .hasAny(['access','mode','trial','guardianUid','points','streak']);  // 결제·체험·포인트는 서버만
      allow delete: if false;                               // 삭제는 서버 함수로

      match /{sub}/{docId} {
        allow read: if isGuardianOf(sid) || isStudentSelf(sid) || adminRole(['owner','admin']);
        allow write: if false;                              // 풀이·복습은 서버(Admin SDK)만 기록
      }
    }

    match /textbooks/{id} {
      allow read: if signedIn();
      allow write: if adminRole(['owner','admin','editor']);
      match /units/{u} { allow read: if signedIn(); allow write: if adminRole(['owner','admin','editor']); }
    }

    match /questions/{qid} {
      allow read: if isAdmin();         // 학생은 배정 스냅샷으로만 문항을 봄
      allow write: if adminRole(['owner','admin','editor','reviewer']);
      match /private/{doc} { allow read, write: if adminRole(['owner','admin','editor','reviewer']); }
    }

    match /{col}/{id} {
      allow read, write: if col in ['appConfig','aiUsageLogs','aiJobs','adminAuditLogs','statsDaily']
        && adminRole(['owner','admin']);
    }
  }
}
```

> 규칙은 `@firebase/rules-unit-testing`과 에뮬레이터로 테스트합니다. 테스트 케이스: 타 보호자 자녀 접근 거부, 학생의 attempts 직접 쓰기 거부, 일반 사용자의 questions/private 읽기 거부, claims 없는 사용자의 admin 경로 거부.

## 7. 프로필 전환(방식 A) 처리

- 보호자 세션에서 자녀 프로필 선택 시 서버가 `activeStudentId`를 세션 쿠키와 별도의 서명 쿠키로 발급
- PIN이 설정된 경우 PIN 검증 후 발급 (PIN은 해시로 저장, 시도 횟수 제한)
- 학생 모드에서는 결제·설정·리포트 메뉴를 숨김
