# Google 로그인과 보호자 학습 프로필

2026-10-14. B 디자인을 기준으로 보호자 Google 로그인, 서버 세션, 학생 프로필 저장을 구현했습니다.

## 현재 동작

- `/login`: 보호자 Google 로그인 또는 로그인 없이 체험하기.
- `/api/session`: Google ID 토큰의 서명·폐기 여부·이메일 검증·로그인 시각을 확인하고 5일짜리 HttpOnly 세션 쿠키를 발급합니다. 로그인 직후 5분 이내 토큰만 허용하며 custom/password 토큰은 거절합니다.
- `/onboarding`: 로그인한 보호자가 닉네임, 중학교 학년, 차분한 학습 모드를 설정합니다. 미로그인 접근은 `/login`으로 이동합니다.
- `/api/profile`: 서버가 세션 UID를 확인하고 보호자 본인 소유 프로필만 읽거나 수정합니다. 사용자와 학생 문서는 Firestore 트랜잭션으로 함께 저장합니다. 동시 최초 저장도 하나의 프로필을 유지합니다.
- `users/{uid}.activeStudentId`가 첫 학생 프로필을 가리킵니다. 이번 단계에서는 보호자당 1개 프로필만 지원합니다. 학생 직접 로그인, 초대 코드, 여러 자녀 전환, 관리자 권한 부여는 아직 없습니다.
- B 화면의 로그인 배너와 설정 모달에서 로그인·프로필 변경·로그아웃을 할 수 있습니다.
- **프로필만 서버에 저장됩니다. 샘플 문제의 풀이·포인트·북마크·복습은 아직 브라우저 기록입니다.** 클라이언트 정답과 포인트를 운영 데이터로 업로드하지 않습니다. 학년별 문제 배정도 아직 구현 전입니다.
- 체험 기록은 기존 `nohakwon:learning:v1`, 로그인 기록은 UID와 학생 ID를 포함한 별도 키에 저장합니다. 자동 합치기는 하지 않습니다. 같은 출처의 탭에는 계정 변경을 알리고 새로고침합니다.

## 로컬 설정

Node.js 22 이상. 저장소 루트에서 `npm ci`, `npm run dev`를 실행합니다.
`apps/web/.env.example`을 참고해 `apps/web/.env.local`에 설정합니다. 해당 파일은 Git 및 Vercel 소스 업로드에서 제외합니다.

브라우저에 필요한 웹 앱 식별자:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

서버 전용 인증 정보:

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY` — PEM 줄바꿈을 `\n`으로 입력해도 지원합니다.

`APP_ORIGIN`은 운영 서비스의 정확한 HTTPS origin을 설정합니다. 로컬에서는 비워 두고 현재 요청 origin을 검사합니다. 요청 Origin과 전용 헤더가 일치하지 않으면 변경 요청을 거절합니다. 세션 쿠키는 `SameSite=Lax`, 운영에서는 `Secure`를 사용합니다.

Firebase Console에서 Google 로그인을 활성화하고 실제 접속 호스트를 승인된 도메인에 추가해야 합니다. 제공된 `barum-10aad` 프로젝트에서 Google 활성화와 Firestore 연결을 확인했습니다. 기존 도메인을 유지하고 `127.0.0.1`만 추가했습니다. Analytics는 초기화하지 않습니다.

## 보안과 운영

- 서비스 계정 비공개 키는 절대로 `NEXT_PUBLIC_` 변수, 저장소, 화면, 로그에 넣지 않습니다.
- 채팅 등으로 전달했던 키는 Google Cloud IAM의 해당 서비스 계정에서 새 키를 발급한 뒤 서버 환경변수를 교체하고, 연결을 검증한 다음 이전 키를 삭제해야 합니다. 키 원문은 문서에 기록하지 않습니다.
- 현재 서버 전용 데이터 경로에 맞춰 `firestore.rules`는 직접 클라이언트 읽기·쓰기를 모두 차단합니다. 프로젝트의 기존 배포 규칙이 동일한 차단 상태임을 확인했으므로 원격 규칙을 덮어쓰지 않았습니다.
- 서버 Admin SDK는 보안 규칙을 우회하므로 각 API에서 세션과 소유권을 반드시 확인합니다. 닉네임·학년·calm 외 입력은 거부합니다. role, guardianUid, 학생 ID, 포인트를 클라이언트에서 지정할 수 없습니다.
- 로그인 SDK는 메모리 persistence만 사용하고 ID 토큰을 얻은 후 브라우저 Firebase 세션을 종료합니다. 서버 쿠키만 로그인 상태를 유지합니다. 로그아웃은 현재 브라우저 세션을 종료하며 다른 기기의 세션까지 폐기하지 않습니다.
- 보호자 동의 정책, 약관·개인정보 처리방침, 탈퇴·데이터 삭제, 학생 연결, 운영 속도 제한/App Check 등은 실제 서비스 출시 전 후속 범위입니다. 현재 화면을 법적 동의 절차로 간주하면 안 됩니다.
- Firebase SDK 12 계열과 Node.js 22를 사용합니다. 24.12 이상을 요구하는 하위 app 패키지 업데이트는 루트 overrides로 고정했습니다. 런타임 업그레이드 시 함께 재검토합니다.

## 검증

- `npm test`: 학습 및 계정 정책 16개 테스트.
- `npm run typecheck`, `npm run build`: 통과.
- 실제 Firestore: 동시 최초 프로필 생성, 수정·조회, 다른 보호자의 읽기·쓰기 거부. 무작위 ID의 검사 전용 데이터만 생성했고 검사 후 정리했습니다.
- HTTP: 미로그인 API·보호된 페이지 접근, 잘못된 토큰·쿠키, 외부 출처, 누락 헤더, 과대 요청, 로그아웃 쿠키 제거를 검사합니다.
- 사용자가 Chrome에서 Google 로그인을 완료한 뒤 실제 계정으로 온보딩 화면 진입, `나호 / 중학교 1학년` 프로필 저장, B 화면 진입을 확인했습니다. 새로고침 후에도 세션이 유지되고 온보딩 페이지에서 저장된 닉네임·학년을 다시 불러왔습니다. 로그인은 외부 Chrome에서 확인하며 앱 내 브라우저에서는 OAuth를 진행하지 않습니다.

공식 참고: [Firebase 세션 쿠키](https://firebase.google.com/docs/auth/admin/manage-cookies), [Google 로그인](https://firebase.google.com/docs/auth/web/google-signin), [Firestore 트랜잭션](https://firebase.google.com/docs/firestore/manage-data/transactions).
