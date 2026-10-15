"use client";
import { Localize, LocaleProvider, PersistedLocale } from "./localize";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Swords,
  UserRound,
} from "lucide-react";
import { RedeemInvite } from "./family-links";
import type { LearnerProfile } from "@/lib/account";
import { schoolLevelOf, type Grade } from "@/lib/education";
import { SchoolGradeFields } from "./school-grade-fields";
import { googleIdToken, signInError } from "@/lib/firebase/client";
import {
  accountRequest,
  broadcastAccountChange,
  useAccount,
} from "./account-provider";

function AccountFrame({
  children,
  setup = false,
}: {
  children: ReactNode;
  setup?: boolean;
}) {
  return (
    <PersistedLocale>
      <Localize>
        <div className="app theme-b account-page">
          <header className="account-header">
            <Link className="brand" href="/b">
              <span className="brand-symbol">
                <Swords size={27} />
              </span>
              <span>
                nohakwon<small>노학원</small>
              </span>
            </Link>
            <Link className="account-back" href="/b">
              <ArrowLeft size={16} />
              학습 화면으로
            </Link>
          </header>
          <main className="account-layout">
            <section className="account-story">
              <span className="eyebrow">A LITTLE QUEST. A BIGGER YOU.</span>
              <h1>
                배움이 모험이 되는 곳.
                <br />
                <span>함께, 한 걸음씩.</span>
              </h1>
              <p>
                국어부터 과학까지, 다섯 명의 동료와
                <br />
                매일 조금 더 단단한 나를 만나요.
              </p>
              <div className="account-art">
                <img
                  src="/images/party.png"
                  alt="다섯 과목을 함께 모험하는 캐릭터 동료들"
                />
                <div className="account-art-caption">
                  <Sparkles size={16} />
                  <span>오늘의 작은 도전이 내일의 실력으로.</span>
                </div>
              </div>
              <div className="account-features">
                <span>
                  <BookOpen size={17} />
                  5과목 · 하루 50문제
                </span>
                <span>
                  <ShieldCheck size={17} />
                  나만의 속도로 성장
                </span>
              </div>
            </section>
            <section className="account-card">
              <div className="account-steps" aria-label="시작 단계">
                <span className={setup ? "complete" : "active"}>
                  {setup ? <Check size={14} /> : "1"} 보호자 로그인
                </span>
                <ChevronRight size={13} />
                <span className={setup ? "active" : ""}>2 프로필 설정</span>
              </div>
              {children}
            </section>
          </main>
          <footer className="account-footer">
            작은 배움을 쌓아가는 우리들의 공간, 노학원.
          </footer>
        </div>
      </Localize>
    </PersistedLocale>
  );
}

export function LoginScreen({
  configured,
  next,
}: {
  configured: boolean;
  next: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login() {
    setBusy(true);
    setError("");
    try {
      const idToken = await googleIdToken();
      const result = await accountRequest<{ next: string }>(
        "/api/session",
        "POST",
        { idToken },
      );
      broadcastAccountChange();
      window.location.assign(result.next === "/b" ? "/b" : "/onboarding");
    } catch (error) {
      setError(signInError(error));
      setBusy(false);
    }
  }
  return (
    <PersistedLocale>
      <Localize>
        <AccountFrame>
          <span className="account-emblem">
            <Swords size={27} />
          </span>
          <p className="eyebrow">LET YOUR ADVENTURE BEGIN</p>
          <h2>우리의 첫 번째 퀘스트</h2>
          <p className="account-description">
            보호자 Google 계정으로 로그인하고,
            <br />
            아이만의 학습 프로필을 만들어 주세요.
          </p>
          {next ? (
            <Link className="primary-button full-width" href={next}>
              이어서 시작하기
              <ArrowRight size={18} />
            </Link>
          ) : (
            <button
              className="google-button"
              disabled={busy || !configured}
              onClick={login}
            >
              {busy ? (
                <LoaderCircle className="spin" size={20} />
              ) : (
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="#4285F4"
                    d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.88-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59A5.97 5.97 0 0 1 12 5.95Z"
                  />
                </svg>
              )}
              {busy ? "Google 계정을 확인하고 있어요…" : "Google로 시작하기"}
            </button>
          )}
          {!configured && (
            <p className="account-notice" role="status">
              로그인 연결을 준비 중이에요. 아래에서 먼저 학습을 체험할 수
              있어요.
            </p>
          )}
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <div className="account-divider">
            <span>먼저 둘러보고 싶다면</span>
          </div>
          <Link className="secondary-button full-width" href="/b">
            로그인 없이 학습 체험
            <ArrowRight size={17} />
          </Link>
          <div className="account-info">
            <ShieldCheck size={21} />
            <p>
              학생 개인 Google 계정 없이 시작할 수 있어요.
              <br />
              프로필은 보호자 계정에 저장됩니다.
            </p>
          </div>
          <p className="account-fineprint">
            로그인 후 교재와 문제 풀이 기록은
            <br />
            계정에 저장되어 다른 기기에서도 이어집니다.
          </p>
        </AccountFrame>
      </Localize>
    </PersistedLocale>
  );
}

export function OnboardingScreen({
  profile,
}: {
  profile: LearnerProfile | null;
}) {
  const account = useAccount();
  const [nickname, setNickname] = useState(profile?.nickname ?? "");
  const [schoolLevel, setSchoolLevel] = useState(schoolLevelOf(profile));
  const [grade, setGrade] = useState<Grade>(profile?.grade ?? 1);
  const [calm, setCalm] = useState(profile?.calm ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <PersistedLocale>
      <Localize>
        <AccountFrame setup>
          <span className="account-emblem">
            <UserRound size={27} />
          </span>
          <p className="eyebrow">YOUR VERY OWN ADVENTURE</p>
          <h2>{profile ? "나의 학습 프로필" : "어떤 모험가로 시작할까요?"}</h2>
          <p className="account-description">
            실명 대신 좋아하는 닉네임도 좋아요.
            <br />
            학습할 학생의 프로필을 설정해 주세요.
          </p>
          <form
            className="settings-form onboarding-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await account.saveProfile({
                  nickname,
                  schoolLevel,
                  grade,
                  calm,
                });
                window.location.assign("/b");
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "프로필을 저장하지 못했어요.",
                );
                setBusy(false);
              }
            }}
          >
            <label htmlFor="learner-nickname">닉네임</label>
            <input
              id="learner-nickname"
              placeholder="예: 별빛 모험가"
              value={nickname}
              required
              maxLength={20}
              autoComplete="off"
              onChange={(event) => setNickname(event.target.value)}
            />
            <small className="muted">
              언제든지 설정에서 바꿀 수 있어요. (최대 20자)
            </small>
            <SchoolGradeFields
              value={{ schoolLevel, grade }}
              onChange={(v) => {
                setSchoolLevel(v.schoolLevel);
                setGrade(v.grade);
              }}
            />
            <label className="toggle-label">
              <span>
                <strong>차분하게 학습하기</strong>
                <small>장식과 움직임을 줄여 집중해요.</small>
              </span>
              <input
                type="checkbox"
                checked={calm}
                onChange={(event) => setCalm(event.target.checked)}
              />
            </label>
            <p className="account-fineprint">
              등록한 교재와 선택한 학년·단원에 맞춰
              <br />
              검증된 문제를 배정합니다.
            </p>
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button full-width"
              disabled={busy || !nickname.trim()}
              type="submit"
            >
              {busy ? (
                <>
                  <LoaderCircle size={18} className="spin" />
                  프로필 저장 중…
                </>
              ) : (
                <>
                  {profile ? "프로필 저장하기" : "나의 모험 시작하기"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          {!profile && <RedeemInvite />}
        </AccountFrame>
      </Localize>
    </PersistedLocale>
  );
}
